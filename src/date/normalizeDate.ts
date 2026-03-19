/**
 * Robust date normalization engine for lottery ticket OCR.
 * Handles OCR errors (O/0, |/I), multiple formats, English/French months.
 */

import type { LotteryId } from '../types/lottery';
import { LOTTERY_DRAW_DAYS } from '../constants/lotteryDrawDays';

export interface DateParseResult {
  dateISO: string;
  score: number;
  source: string;
}

const MONTH_EN: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_FR: Record<string, number> = {
  janv: 1, janvier: 1, févr: 2, fevr: 2, février: 2, fevrier: 2,
  mars: 3, avr: 4, avril: 4, mai: 5, juin: 6, juil: 7, juillet: 7,
  août: 8, aout: 8, sept: 9, septembre: 9, oct: 10, octobre: 10,
  nov: 11, novembre: 11, déc: 12, dec: 12, décembre: 12, decembre: 12,
};

const MONTH_MAP = { ...MONTH_EN, ...MONTH_FR };

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Pre-clean: OCR corrections (O->0, |->/, I->1 near digits), normalize spaces */
function preClean(text: string): string {
  let s = text.toUpperCase().replace(/\s+/g, ' ').trim();
  // Fix "1 DRAW" + "FRI SEP05 25" merged: "1DRAWSEP05" -> "1 DRAW SEP05"
  s = s.replace(/(\d)DRAW(?=[A-Z])/gi, '$1 DRAW ');
  s = s.replace(/DRAW(?=[A-Z])/gi, 'DRAW ');
  // Fix weekday+month concatenated: "FRISEP05" -> "FRI SEP05"
  const months = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';
  s = s.replace(new RegExp(`(FRI|TUE|WED|THU|SAT|SUN|MON)(?=${months})`, 'gi'), '$1 ');
  // In date-like tokens: O->0 (e.g. JAN1O2025), |->/, I->1
  s = s.replace(/(\d)O(\d)/g, '$10$2').replace(/O(\d)/g, (_, d) => '0' + d);
  s = s.replace(/\|/g, '/').replace(/(\d)I(\d)/g, '$11$2');
  s = s.replace(/,/g, ' ').replace(/\./g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function parseYear(y: string): number {
  const n = parseInt(y, 10);
  if (y.length === 2) return n <= 50 ? 2000 + n : 1900 + n;
  return n;
}

function toISO(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2030 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractCandidates(text: string): Array<{ iso: string; score: number; source: string }> {
  const results: Array<{ iso: string; score: number; source: string }> = [];
  const seen = new Set<string>();

  const add = (iso: string, score: number, source: string) => {
    if (iso && !seen.has(iso)) {
      seen.add(iso);
      results.push({ iso, score, source });
    }
  };

  // YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD
  let m = text.match(/\b(20\d{2})[-/]?(\d{1,2})[-/]?(\d{1,2})\b/);
  if (m) {
    const iso = toISO(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    if (iso) add(iso, 0.95, m[0]);
  }
  m = text.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (m) {
    const iso = toISO(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    if (iso) add(iso, 0.9, m[0]);
  }

  // MMM DD YYYY / MMM DD, YYYY / MMM-DD-YYYY (longer month names first to avoid partial matches)
  const monthKeys = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length);
  const monthWord = monthKeys.join('|');
  const reMonth = new RegExp(`\\b(${monthWord})\\s*[-,]?\\s*(\\d{1,2})\\s*[-,]?\\s*(\\d{2,4})\\b`, 'gi');
  let match;
  while ((match = reMonth.exec(text)) !== null) {
    const month = MONTH_MAP[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const year = parseYear(match[3]);
    const iso = toISO(year, month, day);
    if (iso) add(iso, match[3].length === 4 ? 0.9 : 0.75, match[0]);
  }

  // DD MMM YYYY / DD MMM YY
  const reDayMonth = new RegExp(`\\b(\\d{1,2})\\s+(${monthWord})\\s+(\\d{2,4})\\b`, 'gi');
  while ((match = reDayMonth.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const month = MONTH_MAP[match[2].toLowerCase()];
    const year = parseYear(match[3]);
    const iso = toISO(year, month, day);
    if (iso) add(iso, match[3].length === 4 ? 0.9 : 0.75, match[0]);
  }

  // MMM DD YY (no space between month and day: JAN05 25) or MMMDDYYYY (JAN102025)
  const reShort = new RegExp(`\\b(${monthWord})\\s*([0O]?\\d{1,2})\\s+([0O]?\\d{2})\\b`, 'gi');
  while ((match = reShort.exec(text)) !== null) {
    const month = MONTH_MAP[match[1].toLowerCase()];
    const day = parseInt(match[2].replace(/O/g, '0'), 10);
    const year = parseYear(match[3].replace(/O/g, '0'));
    const iso = toISO(year, month, day);
    if (iso) add(iso, 0.8, match[0]);
  }

  // MMMDDYYYY (no spaces: JAN102025 after OCR O->0 fix)
  const reCompact = new RegExp(`\\b(${monthWord})(\\d{1,2})(\\d{4})\\b`, 'gi');
  while ((match = reCompact.exec(text)) !== null) {
    const month = MONTH_MAP[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const iso = toISO(year, month, day);
    if (iso) add(iso, 0.85, match[0]);
  }

  // MMMDDYY (no spaces: SEP0525, FRISEP0525 after stripping weekday)
  const reCompactYY = new RegExp(`\\b(${monthWord})(\\d{2})(\\d{2})\\b`, 'gi');
  while ((match = reCompactYY.exec(text)) !== null) {
    const month = MONTH_MAP[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const year = parseYear(match[3]);
    const iso = toISO(year, month, day);
    if (iso) add(iso, 0.8, match[0]);
  }

  // MM/DD/YY or MM-DD-YY (North American)
  m = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2})\b/g);
  if (m) {
    for (const part of m) {
      const p = part.split(/[-/]/);
      const a = parseInt(p[0], 10);
      const b = parseInt(p[1], 10);
      const y = parseYear(p[2]);
      if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
        const iso = toISO(y, a, b);
        if (iso) add(iso, 0.6, part);
      }
      if (b >= 1 && b <= 12 && a >= 1 && a <= 31) {
        const iso = toISO(y, b, a);
        if (iso) add(iso, 0.55, part);
      }
    }
  }

  // With weekday: TUE JAN 10 2025 / FRI 2025-01-10
  const reWeekday = new RegExp(`\\b(${WEEKDAY_NAMES.join('|')})\\s+`, 'gi');
  const afterWeekday = text.replace(reWeekday, ' ').trim();
  if (afterWeekday !== text) {
    const sub = extractCandidates(afterWeekday);
    sub.forEach((r) => add(r.iso, r.score + 0.05, r.source));
  }

  // "Draw date: ..." / "For draw: ..."
  const drawPrefix = text.match(/(?:draw\s*date|for\s*draw|draw\s*on|tirage|date\s*du\s*tirage)[:\s]+([^.]+?)(?:\s|$|,)/i);
  if (drawPrefix) {
    const sub = extractCandidates(preClean(drawPrefix[1]));
    sub.forEach((r) => add(r.iso, r.score + 0.05, r.source));
  }

  return results;
}

/** Score by lottery draw day match */
function scoreByDrawDay(iso: string, lotteryId: LotteryId): number {
  const allowed = LOTTERY_DRAW_DAYS[lotteryId];
  if (!allowed) return 0;
  const d = new Date(iso);
  const wd = d.getDay();
  return allowed.includes(wd) ? 0.15 : -0.2;
}

export interface NormalizeDateOutput {
  dateISO?: string;
  confidence: number;
  candidates: string[];
  rawText: string;
  needsUserConfirm: boolean;
}

const CONFIRM_THRESHOLD = 0.1;

export function normalizeDateCandidates(
  rawText: string,
  lotteryType: LotteryId
): NormalizeDateOutput {
  const cleaned = preClean(rawText);
  const extracted = extractCandidates(cleaned);

  if (extracted.length === 0) {
    return {
      confidence: 0,
      candidates: [],
      rawText: rawText.trim(),
      needsUserConfirm: false,
    };
  }

  const scored = extracted.map((r) => ({
    ...r,
    score: r.score + scoreByDrawDay(r.iso, lotteryType),
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  const best = top[0];
  const second = top[1];

  const needsUserConfirm =
    top.length > 1 &&
    second &&
    best.score - second.score < CONFIRM_THRESHOLD &&
    best.score < 0.9;

  return {
    dateISO: best.score > 0.3 ? best.iso : undefined,
    confidence: Math.min(1, Math.max(0, best.score)),
    candidates: top.map((t) => t.iso),
    rawText: rawText.trim(),
    needsUserConfirm,
  };
}
