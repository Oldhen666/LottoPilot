/**
 * LottoPilot Draw Scraper
 * Fetches official lottery results from public sources and upserts to Supabase.
 * Run via GitHub Actions cron (daily).
 * Compliance: Only parses publicly available data, no scraping of private APIs.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrapeLottoMax(): Promise<{ draw_date: string; main: number[]; special: number[] } | null> {
  try {
    const res = await fetch('https://www.olg.ca/en/lottery/play-lotto-max-encore.html', {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const html = await res.text();
    // OLG often embeds JSON in script tags. Fallback: use a known public API if available.
    // For MVP we use a placeholder parser - in production you'd use cheerio/puppeteer or official API
    const match = html.match(/"drawDate":"(\d{4}-\d{2}-\d{2})"|"numbers":\[([^\]]+)\]|"bonus":(\d+)/gi);
    if (match) {
      // Simplified: extract from common patterns
      const numMatch = html.match(/"numbers"\s*:\s*\[(\d+(?:,\s*\d+)*)\]/);
      const bonusMatch = html.match(/"bonus"\s*:\s*(\d+)/);
      const dateMatch = html.match(/"drawDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
      if (numMatch && bonusMatch && dateMatch) {
        const main = numMatch[1].split(',').map((s) => parseInt(s.trim(), 10));
        const special = [parseInt(bonusMatch[1], 10)];
        return { draw_date: dateMatch[1], main, special };
      }
    }
  } catch (e) {
    console.error('Lotto Max scrape error:', e);
  }
  return null;
}

async function scrapeLotto649(): Promise<{ draw_date: string; main: number[]; special: number[] } | null> {
  try {
    const res = await fetch('https://www.olg.ca/en/lottery/play-lotto-649-encore.html', {
      headers: { 'User-Agent': 'LottoPilot/1.0 (compliance; ticket-check only)' },
    });
    const html = await res.text();
    const numMatch = html.match(/"numbers"\s*:\s*\[(\d+(?:,\s*\d+)*)\]/);
    const bonusMatch = html.match(/"bonus"\s*:\s*(\d+)/);
    const dateMatch = html.match(/"drawDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
    if (numMatch && bonusMatch && dateMatch) {
      const main = numMatch[1].split(',').map((s) => parseInt(s.trim(), 10));
      const special = [parseInt(bonusMatch[1], 10)];
      return { draw_date: dateMatch[1], main, special };
    }
  } catch (e) {
    console.error('Lotto 6/49 scrape error:', e);
  }
  return null;
}

// Powerball / Mega Millions: use public data sources
// e.g. data.nashville.gov, or state lottery APIs - many have public JSON
async function scrapePowerball(): Promise<{ draw_date: string; main: number[]; special: number[] } | null> {
  try {
    // Powerball public data example - adjust URL to actual public source
    const res = await fetch('https://data.ny.gov/resource/d6yy-54nr.json?$limit=1&$order=draw_date%20DESC', {
      headers: { 'User-Agent': 'LottoPilot/1.0', Accept: 'application/json' },
    });
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const r = arr[0];
        const main = (r.winning_numbers || '').split(' ').map(Number).filter(Boolean);
        const special = r.multiplier ? [Number(r.multiplier)] : r.powerball ? [Number(r.powerball)] : [];
        return { draw_date: r.draw_date?.slice(0, 10) || '', main, special };
      }
    }
  } catch (e) {
    console.error('Powerball scrape error:', e);
  }
  return null;
}

async function scrapeMegaMillions(): Promise<{ draw_date: string; main: number[]; special: number[] } | null> {
  try {
    const res = await fetch(
      'https://data.ny.gov/resource/5xaw-6ayf.json?$limit=1&$order=draw_date%20DESC',
      { headers: { 'User-Agent': 'LottoPilot/1.0', Accept: 'application/json' } }
    );
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const r = arr[0];
        const main = (r.winning_numbers || '').split(' ').map(Number).filter(Boolean);
        const special = r.mega_ball ? [Number(r.mega_ball)] : [];
        return { draw_date: r.draw_date?.slice(0, 10) || '', main, special };
      }
    }
  } catch (e) {
    console.error('Mega Millions scrape error:', e);
  }
  return null;
}

async function upsert(lotteryId: string, data: { draw_date: string; main: number[]; special: number[] }) {
  const { error } = await supabase.from('draws').upsert(
    {
      lottery_id: lotteryId,
      draw_date: data.draw_date,
      winning_numbers: data.main,
      special_numbers: data.special,
    },
    { onConflict: 'lottery_id,draw_date' }
  );
  if (error) throw error;
  console.log(`Upserted ${lotteryId} ${data.draw_date}`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const scrapers: Array<{ id: string; fn: () => Promise<{ draw_date: string; main: number[]; special: number[] } | null> }> = [
    { id: 'lotto_max', fn: scrapeLottoMax },
    { id: 'lotto_649', fn: scrapeLotto649 },
    { id: 'powerball', fn: scrapePowerball },
    { id: 'mega_millions', fn: scrapeMegaMillions },
  ];

  for (const { id, fn } of scrapers) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const data = await fn();
        if (data && data.main.length > 0) {
          await upsert(id, data);
          break;
        }
      } catch (e) {
        console.error(`${id} attempt ${attempt} failed:`, e);
      }
      await sleep(DELAY_MS);
    }
    await sleep(DELAY_MS);
  }

  console.log('Scrape complete');
}

main();
