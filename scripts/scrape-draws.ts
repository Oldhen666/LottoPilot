/**
 * LottoPilot Draw Scraper
 * Fetches official lottery results from public sources and upserts to Supabase.
 * Loads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from .env automatically.
 * Run: npm run scrape
 * Full history: FETCH_HISTORY=1 npm run scrape
 *
 * Add-ons: after main draws, backfills WCLC EXTRA (extra_number) and OLG ENCORE (encore_number).
 * Local check: npm run monitor (EXTRA/ENCORE flags on latest draw).
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
function parseConcatenatedNumbers(digits: string, mainCount: number, maxNum = 52): number[] {
  const nums: number[] = [];
  let i = 0;
  while (nums.length < mainCount && i < digits.length) {
    const two = digits.slice(i, i + 2);
    const n2 = parseInt(two, 10);
    if (two.length === 2 && n2 >= 1 && n2 <= maxNum && !nums.includes(n2)) {
      nums.push(n2);
      i += 2;
    } else {
      const n1 = parseInt(digits[i], 10);
      if (n1 >= 1 && n1 <= maxNum && !nums.includes(n1)) {
        nums.push(n1);
        i += 1;
      } else {
        break;
      }
    }
  }
  return nums.length === mainCount ? nums.sort((a, b) => a - b) : [];
}

// Browser-like headers; rotate User-Agent on retry to improve CI stability
const LOTTORESULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

const LOTTORESULT_BASE_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9',
};

const FETCH_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 3;

/** Fetch with retry, timeout, and rotating User-Agent for CI stability */
async function fetchLottoResult(
  url: string,
  attempt = 0
): Promise<Response> {
  const ua = LOTTORESULT_USER_AGENTS[attempt % LOTTORESULT_USER_AGENTS.length];
  const headers = { ...LOTTORESULT_BASE_HEADERS, 'User-Agent': ua };
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(to);
    if (res.ok || attempt >= MAX_RETRIES - 1) return res;
    if (res.status === 403 || res.status === 503) {
      if (attempt < MAX_RETRIES - 1) {
        if (USE_LOTTORESULT_FIRST) console.warn(`lottoresult.ca ${res.status}, retry ${attempt + 2}/${MAX_RETRIES}`);
        await sleep(RETRY_DELAY_MS);
        return fetchLottoResult(url, attempt + 1);
      }
    }
    return res;
  } catch (e) {
    clearTimeout(to);
    if (attempt < MAX_RETRIES - 1) {
      if (USE_LOTTORESULT_FIRST) console.warn(`lottoresult.ca fetch error, retry ${attempt + 2}/${MAX_RETRIES}:`, (e as Error).message);
      await sleep(RETRY_DELAY_MS);
      return fetchLottoResult(url, attempt + 1);
    }
    throw e;
  }
}

// Fallback: lottoresult.ca when WCLC fails (e.g. GitHub Actions IP blocked)
// HTML: <h2>Lotto Max - Month Day, Year</h2> + Winning Numbers/Bonus in ballnumber spans
async function scrapeLottoMaxFromLottoResult(limit = 15): Promise<DrawData[]> {
  const draws: DrawData[] = [];
  try {
    const res = await fetchLottoResult('https://www.lottoresult.ca/lotto-max-results');
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
        if (n >= 1 && n <= 52 && !mainNums.includes(n)) mainNums.push(n);
      }
      if (mainNums.length < 7) {
        const concatMatch = winningSection.match(/Winning Numbers:[\s\S]*?(\d{10,20})/i);
        if (concatMatch) {
          mainNums = parseConcatenatedNumbers(concatMatch[1].replace(/\D/g, ''), 7);
        }
      }
      const bonus = bonusMatch ? parseInt(bonusMatch[1], 10) : 0;
      if (mainNums.length === 7 && bonus >= 1 && bonus <= 52) {
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
  // Debug: when CI and 0 draws, log response to diagnose GitHub Actions
  if (USE_LOTTORESULT_FIRST && draws.length === 0) {
    try {
      const d = await fetchLottoResult('https://www.lottoresult.ca/lotto-max-results');
      const h = await d.text();
      const blockCount = (h.match(/<h2>Lotto Max -/gi) || []).length;
      console.warn(
        `[lotto_max lottoresult] status=${d.status} len=${h.length} blocks=${blockCount} snippet=${JSON.stringify(h.slice(0, 200))}`
      );
    } catch (_) {}
  }
  return draws;
}

// Tertiary fallback: lotterycanada.com - main page shows latest draw only (1 per game)
async function scrapeLottoMaxFromLotteryCanada(): Promise<DrawData[]> {
  const draws: DrawData[] = [];
  try {
    const res = await fetchLottoResult('https://www.lotterycanada.com/lotto-max');
    const html = await res.text();
    const dateMatch = html.match(/"datePublished"\s*:\s*"(\d{4})-(\d{2})-(\d{2})"/);
    if (!dateMatch) return draws;
    const draw_date = dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3];
    const numCells = html.match(/>(\d{1,2})<\//g);
    if (!numCells || numCells.length < 8) return draws;
    const nums = numCells.slice(0, 8).map((s) => parseInt(s.replace(/\D/g, ''), 10));
    const main = nums.slice(0, 7).filter((n) => n >= 1 && n <= 52);
    const bonus = nums[7];
    if (main.length === 7 && bonus >= 1 && bonus <= 52) {
      main.sort((a, b) => a - b);
      draws.push({ draw_date, main, special: [bonus] });
    }
  } catch (e) {
    console.error('Lotto Max (lotterycanada.com fallback) error:', e);
  }
  return draws;
}

async function scrapeLotto649FromLotteryCanada(): Promise<DrawData[]> {
  const draws: DrawData[] = [];
  try {
    const res = await fetchLottoResult('https://www.lotterycanada.com/lotto-649');
    const html = await res.text();
    const dateMatch = html.match(/"datePublished"\s*:\s*"(\d{4})-(\d{2})-(\d{2})"/);
    if (!dateMatch) return draws;
    const draw_date = dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3];
    const numCells = html.match(/>(\d{1,2})<\//g);
    if (!numCells || numCells.length < 7) return draws;
    const nums = numCells.slice(0, 7).map((s) => parseInt(s.replace(/\D/g, ''), 10));
    const main = nums.slice(0, 6).filter((n) => n >= 1 && n <= 49);
    const bonus = nums[6];
    if (main.length === 6 && bonus >= 1 && bonus <= 49) {
      main.sort((a, b) => a - b);
      draws.push({ draw_date, main, special: [bonus] });
    }
  } catch (e) {
    console.error('Lotto 649 (lotterycanada.com fallback) error:', e);
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
    const lr = await scrapeLottoMaxFromLottoResult(15);
    if (lr.length > 0) return lr;
  }
  const lc = await scrapeLottoMaxFromLotteryCanada();
  if (lc.length > 0) {
    console.log('Lotto Max: lotterycanada.com fallback 1 draw');
    return lc;
  }
  return [];
}

// Fallback: lottoresult.ca for Lotto 6/49 when WCLC fails
// HTML: <h2>Lotto 649 - Month Day, Year</h2> + Winning Numbers/Bonus in ballnumber spans
async function scrapeLotto649FromLottoResult(limit = 15): Promise<DrawData[]> {
  const draws: DrawData[] = [];
  try {
    const res = await fetchLottoResult('https://www.lottoresult.ca/lotto-649-results');
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
          mainNums = parseConcatenatedNumbers(concatMatch[1].replace(/\D/g, ''), 6, 49);
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
  if (USE_LOTTORESULT_FIRST && draws.length === 0) {
    try {
      const d = await fetchLottoResult('https://www.lottoresult.ca/lotto-649-results');
      const h = await d.text();
      const blockCount = (h.match(/<h2>Lotto 649 -/gi) || []).length;
      console.warn(
        `[lotto_649 lottoresult] status=${d.status} len=${h.length} blocks=${blockCount} snippet=${JSON.stringify(h.slice(0, 200))}`
      );
    } catch (_) {}
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
    const lr = await scrapeLotto649FromLottoResult(15);
    if (lr.length > 0) return lr;
  }
  const lc = await scrapeLotto649FromLotteryCanada();
  if (lc.length > 0) {
    console.log('Lotto 6/49: lotterycanada.com fallback 1 draw');
    return lc;
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
    const maxNum = mainCount === 7 ? 52 : 49;
    const main = nums.slice(0, mainCount).filter((n) => n >= 1 && n <= maxNum).sort((a, b) => a - b);
    const bonus = nums[mainCount];
    if (main.length === mainCount && bonus >= 1 && bonus <= maxNum) {
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

/** WCLC main draw only — stop before Bonus / MAXPLUS so add-on balls are not mixed in. */
function parseWclcMainNumbers(block: string, mainCount: number, bonusNum: number): number[] {
  const mainMax = mainCount === 7 ? 52 : 49;
  const mainSection = block.split(/pastWinNumberBonus|pastWinNumMaxmillions|winNumHomeMaxPlus/i)[0];
  return [...mainSection.matchAll(/<li class="pastWinNumber">(\d+)<\/li>/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n >= 1 && n <= mainMax && n !== bonusNum)
    .slice(0, mainCount);
}

function parseWclcDraws(html: string, mainCount: number, extractExtra = false): DrawData[] {
  const draws: DrawData[] = [];
  // EXTRA sits in the sidebar before the date, but inside the same pastWinNum card.
  // Splitting on the date puts that sidebar onto the previous draw.
  const dateBlocks = html.includes('class="pastWinNum"')
    ? html.split('class="pastWinNum"').slice(1)
    : html.split(/pastWinNumDate/i).slice(1);
  for (const block of dateBlocks) {
    const dateMatch = block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/);
    const dateStr = dateMatch?.[1]?.replace(/\s+/g, ' ').trim();
    if (!dateStr) continue;
    const draw_date = parseWclcDate(dateStr);
    if (!draw_date) continue;

    const bonusMatch = block.match(/pastWinNumberBonus[^>]*>(?:[\s\S]*?)(\d+)/i);
    const bonusNum = bonusMatch ? parseInt(bonusMatch[1], 10) : 0;
    const special = bonusNum ? [bonusNum] : [];

    const mainNums = parseWclcMainNumbers(block, mainCount, bonusNum);

    let extra_number: string | undefined;
    if (extractExtra) {
      const extraMatch = block.match(/pastWinNumExtra">\s*(\d{7})\s*</);
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
    const listRes = await fetchLottoResult(listUrl);
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
      const detailRes = await fetchLottoResult(detailUrl);
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

type ExtraItem = { draw_date: string; extra_number: string };

/** WCLC EXTRA 7-digit from lottoresult.ca draw detail pages (CI path often skips WCLC HTML). */
async function scrapeExtraFromLottoResult(
  game: 'lotto-max' | 'lotto-649',
  limit = 15,
): Promise<ExtraItem[]> {
  const results: ExtraItem[] = [];
  const extraPatterns = [
    /(?:WCLC\s+)?EXTRA(?:\s+Winning\s+Number)?[:\s]+(\d{7})\b/i,
    /EXTRA\s+Ticket\s+Number[:\s]+(\d{7})\b/i,
    /\bExtra:\s*(\d{7})\b/i,
    /Extra\s+number[:\s]+(\d{7})\b/i,
  ];
  try {
    const listUrl = `https://www.lottoresult.ca/${game}-results`;
    const listRes = await fetchLottoResult(listUrl);
    const listHtml = await listRes.text();
    const linkRe = new RegExp(`/${game}-results-([a-z]{3})-([0-9]{1,2})-([0-9]{4})`, 'gi');
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
      const detailRes = await fetchLottoResult(detailUrl);
      const detailHtml = await detailRes.text();
      let extra_number: string | undefined;
      for (const re of extraPatterns) {
        const m = detailHtml.match(re);
        if (m?.[1]) {
          extra_number = m[1];
          break;
        }
      }
      if (extra_number) {
        const draw_date = `${year}-${String(MONTH_ABBR[month.toLowerCase()] ?? 0).padStart(2, '0')}-${day.padStart(2, '0')}`;
        results.push({ draw_date, extra_number });
      }
      await sleep(800);
    }
  } catch (e) {
    console.error('WCLC EXTRA (lottoresult detail) scrape error:', e);
  }
  return results;
}

async function updateExtraOnly(lotteryId: string, drawDate: string, extraNumber: string) {
  const digits = String(extraNumber).replace(/\D/g, '');
  if (digits.length < 7) return;
  const normalized = digits.slice(-7);
  const { error } = await supabase
    .from('draws')
    .update({ extra_number: normalized })
    .eq('lottery_id', lotteryId)
    .eq('draw_date', drawDate);
  if (error) throw error;
  console.log(`Updated EXTRA ${lotteryId} ${drawDate}: ${normalized}`);
}

/** Merge WCLC EXTRA page into existing draw rows (main numbers may have come from lottoresult.ca). */
async function backfillExtraFromWclc(lotteryId: 'lotto_max' | 'lotto_649', limit = 15) {
  const mainCount = lotteryId === 'lotto_max' ? 7 : 6;
  const url =
    lotteryId === 'lotto_max'
      ? 'https://www.wclc.com/winning-numbers/lotto-max-extra.htm'
      : 'https://www.wclc.com/winning-numbers/lotto-649-extra.htm';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const html = await res.text();
    const draws = parseWclcDraws(html, mainCount, true).filter((d) => d.extra_number);
    let n = 0;
    for (const d of draws.slice(0, limit)) {
      if (!d.extra_number) continue;
      if (!DRY_RUN) await updateExtraOnly(lotteryId, d.draw_date, d.extra_number);
      n++;
    }
    console.log(
      `${lotteryId} WCLC EXTRA backfill: ${DRY_RUN ? 'would update' : 'updated'} ${n} draws`,
    );
  } catch (e) {
    console.error(`${lotteryId} WCLC EXTRA backfill error:`, e);
  }
}

async function fetchEncoreNumber(drawDate: string): Promise<string | null> {
  const res = await fetch(`https://www.lotteryextreme.com/canada/encore_numbers(${drawDate})`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const block = html.match(/<ul class=['"]displayball['"][^>]*>([\s\S]*?)<\/ul>/i);
  if (!block) return null;
  const digits = [...block[1].matchAll(/<li>(\d)/gi)].map((m) => m[1]);
  return digits.length >= 7 ? digits.slice(0, 7).join('') : null;
}

/** lottoresult.ca often returns 403. Fill Ontario ENCORE for rows that are still empty. */
async function backfillMissingEncore(since = '2026-07-20') {
  for (const lotteryId of ['lotto_max', 'lotto_649'] as const) {
    const { data, error } = await supabase
      .from('draws')
      .select('draw_date')
      .eq('lottery_id', lotteryId)
      .gte('draw_date', since)
      .is('encore_number', null)
      .order('draw_date', { ascending: false });
    if (error) {
      console.error(`ENCORE lookup (${lotteryId}) failed:`, error.message);
      continue;
    }
    let n = 0;
    for (const row of data ?? []) {
      const drawDate = String(row.draw_date).slice(0, 10);
      try {
        const encore = await fetchEncoreNumber(drawDate);
        if (!encore) {
          console.warn(`ENCORE not found ${lotteryId} ${drawDate}`);
        } else if (!DRY_RUN) {
          await updateEncoreOnly(lotteryId, drawDate, encore);
          n++;
        } else {
          console.log(`would set ENCORE ${lotteryId} ${drawDate} ${encore}`);
          n++;
        }
      } catch (e) {
        console.error(`ENCORE ${lotteryId} ${drawDate} failed:`, e);
      }
      await sleep(400);
    }
    console.log(`OLG ENCORE fallback (${lotteryId}): updated ${n}`);
  }
}

async function main() {
  if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

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

  // Phase 1: WCLC EXTRA + OLG ENCORE — detail pages (needed when main draws came from lottoresult list without EXTRA)
  const addonDetailLimit = FETCH_HISTORY ? 20 : 15;
  for (const { lotteryId, game } of [
    { lotteryId: 'lotto_max' as const, game: 'lotto-max' as const },
    { lotteryId: 'lotto_649' as const, game: 'lotto-649' as const },
  ]) {
    try {
      const extraList = await scrapeExtraFromLottoResult(game, addonDetailLimit);
      if (!DRY_RUN) {
        for (const { draw_date, extra_number } of extraList) {
          await updateExtraOnly(lotteryId, draw_date, extra_number);
        }
      }
      console.log(`WCLC EXTRA (${lotteryId}): ${DRY_RUN ? 'would update' : 'updated'} ${extraList.length} draws`);
    } catch (e) {
      console.error(`WCLC EXTRA (${lotteryId}) failed:`, e);
    }
    await sleep(DELAY_MS);

    try {
      await backfillExtraFromWclc(lotteryId, addonDetailLimit);
    } catch (e) {
      console.error(`WCLC EXTRA HTML (${lotteryId}) failed:`, e);
    }
    await sleep(DELAY_MS);

    try {
      const encoreList = await scrapeOlgEncoreFromLottoResult(game, addonDetailLimit);
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

  try {
    await backfillMissingEncore('2026-07-20');
  } catch (e) {
    console.error('ENCORE fallback failed:', e);
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
