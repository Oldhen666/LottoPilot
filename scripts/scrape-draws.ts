/**
 * LottoPilot Draw Scraper
 * Fetches official lottery results from public sources and upserts to Supabase.
 * Loads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from .env automatically.
 * Run: npm run scrape
 * Full history: FETCH_HISTORY=1 npm run scrape
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const FETCH_HISTORY = process.env.FETCH_HISTORY === '1';
const DRY_RUN = process.env.DRY_RUN === '1';

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const DELAY_MS = 1500;

/** GitHub Actions / CI: WCLC often blocks datacenter IPs. Use lottoresult.ca first for Canadian lotteries. */
const USE_LOTTORESULT_FIRST = process.env.CI === 'true';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type DrawData = {
  draw_date: string;
  main: number[];
  special: number[];
  extra_number?: string;
  encore_number?: string;
  maxmillions_numbers?: string[];
  power_play_multiplier?: number;
  double_play_numbers?: number[];
  mega_multiplier?: number;
};

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function parseWclcDate(str: string): string {
  // "Tuesday, February 17, 2026" -> "2026-02-17"
  const m = str.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i);
  if (!m) return '';
  const month = MONTHS[m[1]] ?? 0;
  const day = parseInt(m[2], 10);
  const year = m[3];
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Parse concatenated digits into mainCount numbers (1-50). e.g. "4153234404548" -> [4,15,32,34,40,45,48]
function parseConcatenatedNumbers(digits: string, mainCount: number): number[] {
  const nums: number[] = [];
  let i = 0;
  while (nums.length < mainCount && i < digits.length) {
    const two = digits.slice(i, i + 2);
    const n2 = parseInt(two, 10);
    if (two.length === 2 && n2 >= 1 && n2 <= 50 && !nums.includes(n2)) {
      nums.push(n2);
      i += 2;
    } else {
      const n1 = parseInt(digits[i], 10);
      if (n1 >= 1 && n1 <= 50 && !nums.includes(n1)) {
        nums.push(n1);
        i += 1;
      } else {
        break;
      }
    }
  }
  return nums.length === mainCount ? nums.sort((a, b) => a - b) : [];
}

// Fallback: lottoresult.ca when WCLC fails (e.g. GitHub Actions IP blocked)
// HTML: <h2>Lotto Max - Month Day, Year</h2> + Winning Numbers/Bonus in ballnumber spans
async function scrapeLottoMaxFromLottoResult(limit = 15): Promise<DrawData[]> {
  const draws: DrawData[] = [];
  try {
    const res = await fetch('https://www.lottoresult.ca/lotto-max-results', {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const html = await res.text();
    const blockRe = /<h2>Lotto Max - (January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})<\/h2>([\s\S]*?)(?=<h2>Lotto Max -|$)/gi;
    const ballRe = /<span class="number ballnumber"[^>]*>(\d+)<\/span>/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null && draws.length < limit) {
      const month = MONTHS[m[1]] ?? 0;
      const day = parseInt(m[2], 10);
      const year = m[3];
      const block = m[4];
      const winningSection = block.match(/Winning Numbers:[\s\S]*?<div class="col-lg-9"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? block;
      const bonusMatch = block.match(/Bonus:[\s\S]*?<span class="number ballnumber"[^>]*>(\d+)<\/span>/i)
        || block.match(/Bonus:[\s\n]*(\d+)/i);
      let mainNums: number[] = [];
      let ballMatch: RegExpExecArray | null;
      ballRe.lastIndex = 0;
      while ((ballMatch = ballRe.exec(winningSection)) !== null && mainNums.length < 7) {
        const n = parseInt(ballMatch[1], 10);
        if (n >= 1 && n <= 50 && !mainNums.includes(n)) mainNums.push(n);
      }
      if (mainNums.length < 7) {
        const concatMatch = winningSection.match(/Winning Numbers:[\s\S]*?(\d{10,20})/i);
        if (concatMatch) {
          mainNums = parseConcatenatedNumbers(concatMatch[1].replace(/\D/g, ''), 7);
        }
      }
      const bonus = bonusMatch ? parseInt(bonusMatch[1], 10) : 0;
      if (mainNums.length === 7 && bonus >= 1 && bonus <= 50) {
        mainNums.sort((a, b) => a - b);
        draws.push({
          draw_date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          main: mainNums,
          special: [bonus],
        });
      }
    }
  } catch (e) {
    console.error('Lotto Max (lottoresult.ca fallback) error:', e);
  }
  return draws;
}

// WCLC: Lotto Max - 7 main + 1 bonus. HTML: pastWinNumber (7x) + pastWinNumberBonus (1x)
// In CI (GitHub Actions), WCLC often blocks datacenter IPs → try lottoresult.ca first
async function scrapeLottoMax(): Promise<DrawData[]> {
  if (FETCH_HISTORY) {
    return scrapeWclcSinceInception(
      'https://www.wclc.com/display-on/display-on-downloads/lotto-max-since-inception.htm?channel=print',
      7
    );
  }
  if (USE_LOTTORESULT_FIRST) {
    const fallback = await scrapeLottoMaxFromLottoResult(15);
    if (fallback.length > 0) {
      console.log(`Lotto Max: lottoresult.ca (CI) ${fallback.length} draws`);
      return fallback;
    }
    console.log('Lotto Max: lottoresult.ca empty, trying WCLC');
  }
  try {
    const res = await fetch('https://www.wclc.com/winning-numbers/lotto-max-extra.htm', {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const html = await res.text();
    const draws = parseWclcDraws(html, 7, true);
    if (draws.length > 0) return draws;
  } catch (e) {
    console.error('Lotto Max (WCLC) scrape error:', e);
  }
  if (!USE_LOTTORESULT_FIRST) {
    console.log('Lotto Max: WCLC returned empty, trying lottoresult.ca fallback');
    return scrapeLottoMaxFromLottoResult(15);
  }
  return [];
}

// Fallback: lottoresult.ca for Lotto 6/49 when WCLC fails
// HTML: <h2>Lotto 649 - Month Day, Year</h2> + Winning Numbers/Bonus in ballnumber spans
async function scrapeLotto649FromLottoResult(limit = 15): Promise<DrawData[]> {
  const draws: DrawData[] = [];
  try {
    const res = await fetch('https://www.lottoresult.ca/lotto-649-results', {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const html = await res.text();
    const blockRe = /<h2>Lotto 649 - (January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})<\/h2>([\s\S]*?)(?=<h2>Lotto 649 -|$)/gi;
    const ballRe = /<span class="number ballnumber"[^>]*>(\d+)<\/span>/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null && draws.length < limit) {
      const month = MONTHS[m[1]] ?? 0;
      const day = parseInt(m[2], 10);
      const year = m[3];
      const block = m[4];
      const winningSection = block.match(/Winning Numbers:[\s\S]*?<div class="col-lg-9"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? block;
      const bonusMatch = block.match(/Bonus:[\s\S]*?<span class="number ballnumber"[^>]*>(\d+)<\/span>/i)
        || block.match(/Bonus:[\s\n]*(\d+)/i);
      let mainNums: number[] = [];
      let ballMatch: RegExpExecArray | null;
      ballRe.lastIndex = 0;
      while ((ballMatch = ballRe.exec(winningSection)) !== null && mainNums.length < 6) {
        const n = parseInt(ballMatch[1], 10);
        if (n >= 1 && n <= 49 && !mainNums.includes(n)) mainNums.push(n);
      }
      if (mainNums.length < 6) {
        const concatMatch = winningSection.match(/Winning Numbers:[\s\S]*?(\d{8,18})/i);
        if (concatMatch) {
          mainNums = parseConcatenatedNumbers(concatMatch[1].replace(/\D/g, ''), 6);
        }
      }
      const bonus = bonusMatch ? parseInt(bonusMatch[1], 10) : 0;
      if (mainNums.length === 6 && bonus >= 1 && bonus <= 49) {
        mainNums.sort((a, b) => a - b);
        draws.push({
          draw_date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          main: mainNums,
          special: [bonus],
        });
      }
    }
  } catch (e) {
    console.error('Lotto 6/49 (lottoresult.ca fallback) error:', e);
  }
  return draws;
}

// WCLC: Lotto 6/49 - 6 main + 1 bonus
// In CI (GitHub Actions), WCLC often blocks datacenter IPs → try lottoresult.ca first
async function scrapeLotto649(): Promise<DrawData[]> {
  if (FETCH_HISTORY) {
    return scrapeWclcSinceInception(
      'https://www.wclc.com/display-on/display-on-downloads/lotto-649-since-inception.htm?channel=print',
      6
    );
  }
  if (USE_LOTTORESULT_FIRST) {
    const fallback = await scrapeLotto649FromLottoResult(15);
    if (fallback.length > 0) {
      console.log(`Lotto 6/49: lottoresult.ca (CI) ${fallback.length} draws`);
      return fallback;
    }
    console.log('Lotto 6/49: lottoresult.ca empty, trying WCLC');
  }
  try {
    const res = await fetch('https://www.wclc.com/winning-numbers/lotto-649-extra.htm', {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const html = await res.text();
    const draws = parseWclcDraws(html, 6, true);
    if (draws.length > 0) return draws;
  } catch (e) {
    console.error('Lotto 6/49 (WCLC) scrape error:', e);
  }
  if (!USE_LOTTORESULT_FIRST) {
    console.log('Lotto 6/49: WCLC returned empty, trying lottoresult.ca fallback');
    return scrapeLotto649FromLottoResult(15);
  }
  return [];
}

// WCLC "Since Inception" print page: "Month Day, Year n1 n2 ... bonus [extra]"
// Lotto Max: 7 main + 1 bonus (+ optional EXTRA ticket id)
// Lotto 649: 6 main + 1 bonus (+ optional "THE PLUS" number)
function parseWclcSinceInception(text: string, mainCount: number): DrawData[] {
  const draws: DrawData[] = [];
  const dateRe = new RegExp(
    `(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s+(\\d{4})\\s+((?:\\d+\\s+){${mainCount + 1}})`,
    'gi'
  );
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(text)) !== null) {
    const line = text.slice(m.index, m.index + 200);
    if (/Maxmillions|Draw\s*#|In the event|Page\s+\d+/i.test(line)) continue;
    const month = MONTHS[m[1]] ?? 0;
    const day = parseInt(m[2], 10);
    const year = m[3];
    const nums = m[4].trim().split(/\s+/).map((n) => parseInt(n, 10));
    const main = nums.slice(0, mainCount).filter((n) => n >= 1 && n <= 50).sort((a, b) => a - b);
    const bonus = nums[mainCount];
    if (main.length === mainCount && bonus >= 1 && bonus <= 50) {
      draws.push({
        draw_date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        main,
        special: [bonus],
      });
    }
  }
  return draws;
}

async function scrapeWclcSinceInception(url: string, mainCount: number): Promise<DrawData[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const contentType = res.headers.get('content-type') || '';
    let text: string;
    if (contentType.includes('pdf')) {
      const buf = await res.arrayBuffer();
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const out = await extractText(pdf, { mergePages: true });
      text = out.text || '';
    } else {
      text = await res.text();
    }
    return parseWclcSinceInception(text, mainCount);
  } catch (e) {
    console.error('WCLC since-inception scrape error:', e);
  }
  return [];
}

function parseWclcDraws(html: string, mainCount: number, extractExtra = false): DrawData[] {
  const draws: DrawData[] = [];
  const dateBlocks = html.split(/pastWinNumDate/i);
  for (let i = 1; i < dateBlocks.length; i++) {
    const block = dateBlocks[i];
    const dateMatch = block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/);
    const dateStr = dateMatch?.[1]?.replace(/\s+/g, ' ').trim();
    if (!dateStr) continue;
    const draw_date = parseWclcDate(dateStr);
    if (!draw_date) continue;

    const bonusMatch = block.match(/pastWinNumberBonus[^>]*>(?:[\s\S]*?)(\d+)/i);
    const bonusNum = bonusMatch ? parseInt(bonusMatch[1], 10) : 0;
    const special = bonusNum ? [bonusNum] : [];

    const mainNums = [...block.matchAll(/class="pastWinNumber"[^>]*>(\d+)</gi)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => n >= 1 && n <= 50 && n !== bonusNum)
      .slice(0, mainCount);

    let extra_number: string | undefined;
    if (extractExtra) {
      const extraMatch = block.match(/(?:extra|ticket|draw)\s*(?:number|#)?\s*[:\s]*(\d{7})/i)
        || block.match(/\b(\d{7})\b/);
      if (extraMatch) extra_number = extraMatch[1];
    }

    if (mainNums.length === mainCount && special.length === 1) {
      draws.push({
        draw_date,
        main: mainNums.sort((a, b) => a - b),
        special,
        ...(extra_number && { extra_number }),
      });
    }
  }
  return draws;
}

// Powerball: NY Open Data. winning_numbers = "09 33 52 64 66 01" (5 main + 1 powerball)
// NOTE: NY Open Data does NOT include Double Play numbers. Catalog + handler + UI are ready;
// when a data source is available, add double_play_numbers to the payload.
async function scrapePowerball(limit = 1): Promise<DrawData[]> {
  try {
    const res = await fetch(
      `https://data.ny.gov/resource/d6yy-54nr.json?$limit=${limit}&$order=draw_date%20DESC`,
      { headers: { 'User-Agent': 'LottoPilot/1.0', Accept: 'application/json' } }
    );
    if (res.ok) {
      const arr = await res.json();
      return (arr || []).map((r: any) => {
        const parts = (r.winning_numbers || '').split(' ').map(Number).filter((n: number) => !isNaN(n));
        const main = parts.slice(0, 5);
        const special = parts.length >= 6 ? [parts[5]] : [];
        const draw_date = r.draw_date?.slice(0, 10) || '';
        const mult = r.multiplier != null ? Number(r.multiplier) : undefined;
        return { draw_date, main, special, power_play_multiplier: mult };
      });
    }
  } catch (e) {
    console.error('Powerball scrape error:', e);
  }
  return [];
}

// OLG ENCORE (Ontario): lottoresult.ca provides "Ontario Encore: XXXXXXX" on draw detail pages
// Same draw date as Lotto Max / Lotto 6/49 (Canada-wide)
type OlgEncoreItem = { draw_date: string; encore_number: string };
const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

async function scrapeOlgEncoreFromLottoResult(
  game: 'lotto-max' | 'lotto-649',
  limit = 5
): Promise<OlgEncoreItem[]> {
  const results: OlgEncoreItem[] = [];
  try {
    const listUrl = `https://www.lottoresult.ca/${game}-results`;
    const listRes = await fetch(listUrl, {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const listHtml = await listRes.text();
    // Match links like lotto-max-results-dec-5-2025 or lotto-649-results-dec-6-2025
    const linkRe = new RegExp(
      `/${game}-results-([a-z]{3})-([0-9]{1,2})-([0-9]{4})`,
      'gi'
    );
    const matches = [...listHtml.matchAll(linkRe)];
    const seen = new Set<string>();
    const toFetch: { month: string; day: string; year: string }[] = [];
    for (const m of matches) {
      const key = `${m[3]}-${String(MONTH_ABBR[m[1].toLowerCase()] ?? 0).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toFetch.push({ month: m[1], day: m[2], year: m[3] });
      if (toFetch.length >= limit) break;
    }

    for (const { month, day, year } of toFetch) {
      const detailUrl = `https://www.lottoresult.ca/${game}-results-${month}-${day}-${year}`;
      const detailRes = await fetch(detailUrl, {
        headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
      });
      const detailHtml = await detailRes.text();
      const encoreMatch = detailHtml.match(/Ontario\s+Encore:\s*(\d{7})/i);
      if (encoreMatch) {
        const draw_date = `${year}-${String(MONTH_ABBR[month.toLowerCase()] ?? 0).padStart(2, '0')}-${day.padStart(2, '0')}`;
        results.push({ draw_date, encore_number: encoreMatch[1] });
      }
      await sleep(800);
    }
  } catch (e) {
    console.error('OLG ENCORE scrape error:', e);
  }
  return results;
}

// Phase 2: ALC TAG (Atlantic) - nightly, 6 digits. From lottoresult.ca "Atlantic Tag: XXXXXX"
type AlcTagItem = { draw_date: string; tag_number: string };
async function scrapeAlcTagFromLottoResult(limit = 5): Promise<AlcTagItem[]> {
  const byDate = new Map<string, AlcTagItem>();
  for (const game of ['lotto-max', 'lotto-649'] as const) {
    try {
      const listUrl = `https://www.lottoresult.ca/${game}-results`;
      const listRes = await fetch(listUrl, {
        headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
      });
      const listHtml = await listRes.text();
      const linkRe = new RegExp(`/${game}-results-([a-z]{3})-([0-9]{1,2})-([0-9]{4})`, 'gi');
      const matches = [...listHtml.matchAll(linkRe)];
      for (const m of matches) {
        if (byDate.size >= limit) break;
        const draw_date = `${m[3]}-${String(MONTH_ABBR[m[1].toLowerCase()] ?? 0).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        if (byDate.has(draw_date)) continue;
        const detailUrl = `https://www.lottoresult.ca/${game}-results-${m[1]}-${m[2]}-${m[3]}`;
        const detailRes = await fetch(detailUrl, {
          headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
        });
        const detailHtml = await detailRes.text();
        const tagMatch = detailHtml.match(/Atlantic\s+Tag:\s*(\d{6})/i);
        if (tagMatch) {
          byDate.set(draw_date, { draw_date, tag_number: tagMatch[1] });
        }
        await sleep(800);
      }
    } catch (e) {
      console.error('ALC TAG scrape error:', e);
    }
  }
  return Array.from(byDate.values());
}

async function upsertAlcTagDraw(data: AlcTagItem) {
  const payload = {
    lottery_id: 'alc_tag',
    draw_date: data.draw_date,
    winning_numbers: [] as number[],
    special_numbers: null as number[] | null,
    tag_number: data.tag_number,
  };
  const { error } = await supabase.from('draws').upsert(payload, { onConflict: 'lottery_id,draw_date' });
  if (error) throw error;
  console.log(`Upserted alc_tag ${data.draw_date}: ${data.tag_number}`);
}

// Mega Millions: NY Open Data
async function scrapeMegaMillions(limit = 1): Promise<DrawData[]> {
  try {
    const res = await fetch(
      `https://data.ny.gov/resource/5xaw-6ayf.json?$limit=${limit}&$order=draw_date%20DESC`,
      { headers: { 'User-Agent': 'LottoPilot/1.0', Accept: 'application/json' } }
    );
    if (res.ok) {
      const arr = await res.json();
      return (arr || []).map((r: any) => {
        const main = (r.winning_numbers || '').split(' ').map(Number).filter((n: number) => !isNaN(n));
        const special = r.mega_ball ? [Number(r.mega_ball)] : [];
        const draw_date = r.draw_date?.slice(0, 10) || '';
        const mult = r.multiplier != null ? Number(r.multiplier) : undefined;
        return { draw_date, main, special, mega_multiplier: mult };
      });
    }
  } catch (e) {
    console.error('Mega Millions scrape error:', e);
  }
  return [];
}

async function upsert(lotteryId: string, data: DrawData) {
  const payload: Record<string, unknown> = {
    lottery_id: lotteryId,
    draw_date: data.draw_date,
    winning_numbers: data.main,
    special_numbers: data.special,
  };
  if (data.extra_number) payload.extra_number = data.extra_number;
  if (data.encore_number) payload.encore_number = data.encore_number;
  if (data.maxmillions_numbers) payload.maxmillions_numbers_json = data.maxmillions_numbers;
  if (data.power_play_multiplier != null) payload.power_play_multiplier = data.power_play_multiplier;
  if (data.double_play_numbers) payload.double_play_numbers_json = data.double_play_numbers;
  if (data.mega_multiplier != null) payload.mega_multiplier = data.mega_multiplier;

  const { error } = await supabase.from('draws').upsert(payload, { onConflict: 'lottery_id,draw_date' });
  if (error) throw error;
  console.log(`Upserted ${lotteryId} ${data.draw_date}`);
}

async function updateEncoreOnly(lotteryId: string, drawDate: string, encoreNumber: string) {
  const { error } = await supabase
    .from('draws')
    .update({ encore_number: encoreNumber })
    .eq('lottery_id', lotteryId)
    .eq('draw_date', drawDate);
  if (error) throw error;
  console.log(`Updated ENCORE ${lotteryId} ${drawDate}: ${encoreNumber}`);
}

async function main() {
  if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const pbLimit = FETCH_HISTORY ? 500 : 1;
  const mmLimit = FETCH_HISTORY ? 500 : 1;

  // Canadian: WCLC (FETCH_HISTORY=1 uses PDF since-inception; else recent HTML)
  for (const { id, fn } of [
    { id: 'lotto_max', fn: scrapeLottoMax },
    { id: 'lotto_649', fn: scrapeLotto649 },
  ]) {
    try {
      const draws = await fn();
      const valid = draws.filter((d) => d.main.length > 0 && d.special.length > 0);
      if (!DRY_RUN) {
        for (const d of valid) await upsert(id, d);
      }
      console.log(`${id}: ${DRY_RUN ? 'would upsert' : 'upserted'} ${valid.length} draws`);
    } catch (e) {
      console.error(`${id} failed:`, e);
    }
    await sleep(DELAY_MS);
  }

  // Phase 1: OLG ENCORE (Ontario) - from lottoresult.ca draw detail pages
  const encoreLimit = FETCH_HISTORY ? 20 : 5;
  for (const { lotteryId, game } of [
    { lotteryId: 'lotto_max', game: 'lotto-max' as const },
    { lotteryId: 'lotto_649', game: 'lotto-649' as const },
  ]) {
    try {
      const encoreList = await scrapeOlgEncoreFromLottoResult(game, encoreLimit);
      if (!DRY_RUN) {
        for (const { draw_date, encore_number } of encoreList) {
          await updateEncoreOnly(lotteryId, draw_date, encore_number);
        }
      }
      console.log(`OLG ENCORE (${lotteryId}): ${DRY_RUN ? 'would update' : 'updated'} ${encoreList.length} draws`);
    } catch (e) {
      console.error(`OLG ENCORE (${lotteryId}) failed:`, e);
    }
    await sleep(DELAY_MS);
  }

  // Phase 2: ALC TAG (Atlantic) - independent nightly game
  const tagLimit = FETCH_HISTORY ? 15 : 5;
  try {
    const tagList = await scrapeAlcTagFromLottoResult(tagLimit);
    if (!DRY_RUN) {
      for (const t of tagList) await upsertAlcTagDraw(t);
    }
    console.log(`ALC TAG: ${DRY_RUN ? 'would upsert' : 'upserted'} ${tagList.length} draws`);
  } catch (e) {
    console.error('ALC TAG failed:', e);
  }
  await sleep(DELAY_MS);

  // US: NY Open Data - supports full history
  for (const { id, fn } of [
    { id: 'powerball', fn: () => scrapePowerball(pbLimit) },
    { id: 'mega_millions', fn: () => scrapeMegaMillions(mmLimit) },
  ]) {
    try {
      const draws = await fn();
      const valid = draws.filter((d) => d.main.length > 0);
      if (!DRY_RUN) {
        for (const d of valid) await upsert(id, d);
      }
      console.log(`${id}: ${DRY_RUN ? 'would upsert' : 'upserted'} ${valid.length} draws`);
    } catch (e) {
      console.error(`${id} failed:`, e);
    }
    await sleep(DELAY_MS);
  }

  console.log('Scrape complete');

  // Update Compass snapshots (pre-computed for app)
  try {
    const { runCompassUpdate } = await import('./update-compass');
    await runCompassUpdate();
  } catch (e) {
    console.warn('Compass update skipped:', (e as Error).message);
  }
}

main();
