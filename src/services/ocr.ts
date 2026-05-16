/**
 * OCR / ticket image parsing via expo-mlkit-ocr (on-device, free).
 * Web: not supported, returns null. Native: ML Kit (Android) / Vision (iOS).
 */

import { Platform } from 'react-native';
import type { LotteryId } from '../types/lottery';
import {
  fixUsPbLeadingDigitNoise,
  mergeUsPbLeadingZeroPair,
  extractMegaBallFromRawText,
  extractMegaBallsPerLineFromRawText,
  extractPowerballFromRawText,
  extractPowerballsPerLineFromRawText,
  normalizeOcrOAsZeroAdjacentDigits,
  parseUsPbMmLine,
  stripUsPlayLineLetterPrefix,
} from './powerballOcr/usParseLine';
import { USE_LAYERED_POWERBALL_OCR } from './powerballOcr/constants';
import { recognizeTicketText } from './powerballOcr/mlkitRecognize';
import { finalizeUsGameSpecialsFromRawText } from './powerballOcr/rawTextSpecialFinalize';
import { copyVariantUrisForDebug } from './ticketPreprocess/debugCopy';
import { preprocessTicketImageForOcr } from './ticketPreprocess/preprocessTicketImage';
import type { ParsedAddOns } from './extractAddOnsFromText';
import { extractAddOnsFromText as extractAddOnsFromRawTicketText } from './extractAddOnsFromText';

/** Dev-only: preprocess variants copied to stable file URIs for UI preview. */
export type TicketPreprocessDebugInfo = { uris: string[]; labels: string[] };

export type { ParsedAddOns } from './extractAddOnsFromText';

export interface ParsedTicket {
  mainNumbers: number[];
  specialNumbers?: number[];
  /** Powerball / Mega Millions: one special ball per play line (aligned with allSets). */
  specialsPerLine?: number[];
  /** Multiple sets (e.g. Lotto Max has 3 lines) */
  allSets?: number[][];
  drawDate?: string; // YYYY-MM-DD if detected
  lotteryId?: string;
  confidence: number;
  /** Raw OCR text for date parsing / debugging */
  rawText?: string;
  /** __DEV__ only: which preprocess variant produced this parse */
  debugOcrVariant?: { label: string; uri: string; score: number };
  /** Add-ons detected from ticket image (EXTRA, ENCORE, TAG, POWER_PLAY, DOUBLE_PLAY) */
  addOnsDetected?: ParsedAddOns;
}

/**
 * Get raw OCR text from image (offline, device-side).
 * Returns null on web or if OCR fails.
 */
export async function getRawOcrText(imageUri: string): Promise<{ fullText: string } | null> {
  if (Platform.OS === 'web') return null;
  try {
    const result = await recognizeTicketText(imageUri);
    const text = result?.text ?? '';
    return text.trim() ? { fullText: text } : null;
  } catch {
    return null;
  }
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseDateFromText(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  // YYYY-MM-DD
  let m = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // MM/DD/YYYY or DD/MM/YYYY (prefer MM/DD for US tickets)
  m = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (m) {
    const [_, a, b, y] = m;
    const ma = parseInt(a, 10);
    const mb = parseInt(b, 10);
    if (ma >= 1 && ma <= 12 && mb >= 1 && mb <= 31) return `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
    if (mb >= 1 && mb <= 12 && ma >= 1 && ma <= 31) return `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }
  // Month DD, YYYY or DD Month YYYY
  m = normalized.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (m) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    if (month) return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = normalized.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(20\d{2})\b/i);
  if (m) {
    const month = MONTH_NAMES[m[2].toLowerCase()];
    if (month) return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // SEP05 25 or SEP 05 25 (WCLC ticket format: short month, day, 2-digit year)
  m = normalized.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s*(\d{1,2})\s+(\d{2})\b/i);
  if (m) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    const day = m[2];
    const yy = parseInt(m[3], 10);
    const year = yy >= 0 && yy <= 50 ? 2000 + yy : 1900 + yy;
    if (month) return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // DD Month YY or DD Month YYYY (e.g. 05 SEP 25, 5 September 2025)
  m = normalized.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{2,4})\b/i);
  if (m) {
    const month = MONTH_NAMES[m[2].toLowerCase()];
    const day = m[1];
    const yPart = m[3];
    const year = yPart.length === 2
      ? (parseInt(yPart, 10) <= 50 ? 2000 + parseInt(yPart, 10) : 1900 + parseInt(yPart, 10))
      : parseInt(yPart, 10);
    if (month && year >= 2000 && year <= 2030) return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // "Draw date: ..." or "For draw: ..." - extract and parse the date part after
  const drawPrefixMatch = normalized.match(/(?:draw\s*date|for\s*draw|draw\s*on)[:\s]+([^.]+?)(?:\s|$|,)/i);
  if (drawPrefixMatch) {
    const datePart = drawPrefixMatch[1].trim();
    if (datePart) {
      const parsed = parseDateFromText(datePart);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

/** Extract numbers from a single line, excluding transaction IDs and long numbers */
function extractNumbersFromLine(line: string, mainMax: number): number[] {
  const nums = line.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n) && n >= 1 && n <= mainMax) ?? [];
  const seen = new Set<number>();
  for (const n of nums) {
    if (!seen.has(n)) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

function stripDiacritics(s: string): string {
  try {
    return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return s;
  }
}

function extractCanadaNumbersFromLine(line: string, mainMax: number): number[] {
  // Quebec slips frequently glue digits into even-length runs:
  // "273341" -> 27 33 41, "0308" -> 03 08, "1522" -> 15 22.
  // Also common OCR: "o2" -> "02".
  const normalized = line.replace(/[oO](?=\d)/g, '0');
  const runs = normalized.match(/\d+/g) ?? [];
  const out: number[] = [];
  for (const r of runs) {
    if (r.length <= 2) {
      out.push(parseInt(r, 10));
      continue;
    }
    if (r.length % 2 === 0) {
      for (let i = 0; i < r.length; i += 2) out.push(parseInt(r.slice(i, i + 2), 10));
      continue;
    }
    // Odd-length runs are unlikely for main plays; treat as a whole number so the caller can reject it.
    out.push(parseInt(r, 10));
  }
  const seen = new Set<number>();
  for (const n of out) {
    if (!isNaN(n) && n >= 1 && n <= mainMax && !seen.has(n)) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

function extractCanadaMainSetsFromLinesText(
  fullText: string,
  mainCount: number,
  mainMax: number,
  maxPlays: number,
): number[][] {
  const extraLikeLabel = (t: string) =>
    /\b(?:extra|xtra|bxtra|eytra|extea|exfra|etra|encore|tag)\b/i.test(t);
  const badLine = (t: string) => {
    if (!t || t.length < 3) return true;
    // Avoid metadata-heavy sections that are very numeric.
    if (
      /\b(?:printed|entered|see\s+reverse|system|syst|draw|date|time|total|price|ticket|terminal|tr:|ret#)\b/i.test(t)
    )
      return true;
    if (extraLikeLabel(t)) return true;
    if (/[$€£]/.test(t)) return true;
    // French QC slips: filter common non-play keywords near disclaimers / extra block.
    if (/\b(?:tirage|journ(?:e|é)e|prix\s+du\s+billet|signez|détails)\b/i.test(t)) return true;
    if (/\b\d{1,2}\/\d{1,2}\/(20\d{2}|\d{2})\b/.test(t)) return true;
    if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(t)) return true;
    // Long transaction IDs often contain hyphenated blocks.
    if (/\b\d{2,}-\d{2,}-\d{2,}/.test(t)) return true;
    return false;
  };

  const allSets: number[][] = [];
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3);

  for (const line of lines) {
    if (allSets.length >= maxPlays) break;
    // Only skip the label line itself; subsequent lines may still contain play numbers
    // due to OCR line-order shuffling on QC slips.
    if (extraLikeLabel(line)) continue;
    if (badLine(line)) continue;
    const rawPairs = line.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) ?? [];
    // Prefer Canada-specific extraction to handle glued digit runs (QC / BCLC).
    let nums = extractCanadaNumbersFromLine(line, mainMax);
    // Keep one full play line even when OCR produces slight overflow tokens (e.g. 51/52) so UI matches rawText.
    // We intentionally do not auto-mutate values here; user can edit if needed.
    if (
      nums.length !== mainCount &&
      rawPairs.length === mainCount &&
      new Set(rawPairs).size === mainCount &&
      rawPairs.every((n) => n >= 1 && n <= mainMax + 5)
    ) {
      nums = [...rawPairs].sort((a, b) => a - b);
    }
    if (nums.length === mainCount) {
      // Guard: a "play line" with only single-digit numbers is almost certainly EXTRA or noise (e.g. "2 4 6 8 1 3 5").
      if (Math.max(...nums) <= 9) continue;
      allSets.push(nums);
      continue;
    }
    // Some tickets include a trailing marker (e.g., QP). Allow >=mainCount then take first mainCount.
    if (nums.length > mainCount) {
      allSets.push(nums.slice(0, mainCount));
    }
  }

  return allSets;
}

/** Exclude transaction ID (e.g. 40-5802-4769737-848-00) and EXTRA (2777382) */
function cleanTicketText(text: string): string {
  return text
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}-\d{4}-\d{7}-\d{3}-\d{2}\b/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .trim();
}

/** US PB/MM row parsing lives in powerballOcr/usParseLine (includes CA play-line "A" stripping). */

function extractUsPbMmFromBlocks(
  blocks: Array<{ text: string; lines?: Array<{ text: string }> }>,
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
  maxPlays: number,
): { allSets: number[][]; specialsPerLine: number[] } {
  const isPlayLike = (line: string): boolean => {
    const t = line.replace(/\s+/g, ' ').trim();
    if (t.length < 3) return false;
    // Skip obvious non-play regions (odds tables and disclaimers are very numeric).
    if (
      /\bODDS\b|\bJACKPOT\b|\bWIN\s*\/\s*SHARE\b|\bWINSHARE\b|\bPRIZE\b|\bYOU\s+MATCH\b|\bMULTIPLIER\b|\bTIMES\b|\bRAFFLE\b/i.test(
        t,
      )
    )
      return false;
    if (/\bPRINTED\b|\bRET#\b|\bDRAW\b|\bCASH\s+VALUE\b|\bEST\.\s*CASH\b/i.test(t)) return false;
    if (/\b(?:FRI|SAT|SUN|MON|TUE|WED|THU)\b/i.test(t) && /\b20\d{2}\b/.test(t)) return false;

    // Must look like a play line: either starts with a play letter + whitespace + digits (avoid glued noise like "BD48"),
    // or contains QP/OP/GP markers, or (Mega Millions) contains MB marker ("MB: 07", "MB23", "MBZ3").
    const hasPlayPrefix = /^\s*[A-Z]{1,2}\s*[\.\)]?\s+\d/.test(t);
    const hasPickMarker = /\b(?:QP|OP|GP|CP|AP|0P|aP|oP)\b/i.test(t);
    const hasMbMarker = specialMax <= 25 && /\bMB\s*[:#\.]?\s*\w?\d{1,2}\b/i.test(t);
    const norm = normalizeOcrOAsZeroAdjacentDigits(t);
    const stripped = stripUsPlayLineLetterPrefix(norm).replace(/\s+/g, ' ').trim();
    const toks = stripped.match(/\b\d{1,4}\b/g) ?? [];
    const hasGluedFourDigitPairRun =
      !hasPlayPrefix &&
      !hasPickMarker &&
      !hasMbMarker &&
      // CA often OCRs "14 24" as "1424" in otherwise clean main-number lines.
      toks.length === 4 &&
      toks.some((s) => s.length === 4) &&
      toks.filter((s) => s.length <= 2).length === 3 &&
      !/[$€£]|\/|:|-|\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/i.test(norm);
    const hasBareFiveMains =
      !hasPlayPrefix &&
      !hasPickMarker &&
      !hasMbMarker &&
      // Strict: a line that is basically just five 1–2 digit tokens.
      /^\s*(\d{1,2}\s+){4}\d{1,2}\s*$/.test(stripped) &&
      // Avoid date/price-ish lines.
      !/[$€£]|\/|:|-|\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/i.test(norm);
    if (!hasPlayPrefix && !hasPickMarker && !hasMbMarker && !hasBareFiveMains && !hasGluedFourDigitPairRun) return false;
    const p = parseUsPbMmLine(t, mainCount, mainMax, specialMin, specialMax);
    return p.main.length >= mainCount;
  };

  const allSets: number[][] = [];
  const specialsPerLine: number[] = [];
  outer: for (const block of blocks) {
    const lineTexts: string[] = [];
    if (block.lines?.length) {
      for (const line of block.lines) lineTexts.push(line.text);
    } else if (block.text?.trim()) {
      lineTexts.push(block.text);
    }
    for (const rawLine of lineTexts) {
      if (!isPlayLike(rawLine)) continue;
      const t = rawLine.replace(/\s+/g, ' ').trim();
      const { main, special } = parseUsPbMmLine(t, mainCount, mainMax, specialMin, specialMax);
      if (main.length >= mainCount) {
        allSets.push(main.slice(0, mainCount));
        specialsPerLine.push(special != null && special > 0 ? special : 0);
        if (allSets.length >= maxPlays) break outer;
      }
    }
  }
  return { allSets, specialsPerLine };
}

/** ML Kit often merges rows — split full OCR text by newlines and parse each row. */
function extractUsPbMmFromLinesText(
  fullText: string,
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
  maxPlays: number,
): { allSets: number[][]; specialsPerLine: number[] } {
  const isPlayLike = (line: string): boolean => {
    const t = line.replace(/\s+/g, ' ').trim();
    if (t.length < 3) return false;
    if (
      /\bODDS\b|\bJACKPOT\b|\bWIN\s*\/\s*SHARE\b|\bWINSHARE\b|\bPRIZE\b|\bYOU\s+MATCH\b|\bMULTIPLIER\b|\bTIMES\b|\bRAFFLE\b/i.test(
        t,
      )
    )
      return false;
    if (/\bPRINTED\b|\bRET#\b|\bDRAW\b|\bCASH\s+VALUE\b|\bEST\.\s*CASH\b/i.test(t)) return false;
    if (/\b(?:FRI|SAT|SUN|MON|TUE|WED|THU)\b/i.test(t) && /\b20\d{2}\b/.test(t)) return false;
    const hasPlayPrefix = /^\s*[A-Z]{1,2}\s*[\.\)]?\s+\d/.test(t);
    const hasPickMarker = /\b(?:QP|OP|GP|CP|AP|0P|aP|oP)\b/i.test(t);
    const hasMbMarker = specialMax <= 25 && /\bMB\s*[:#\.]?\s*\w?\d{1,2}\b/i.test(t);
    const norm = normalizeOcrOAsZeroAdjacentDigits(t);
    const stripped = stripUsPlayLineLetterPrefix(norm).replace(/\s+/g, ' ').trim();
    const toks = stripped.match(/\b\d{1,4}\b/g) ?? [];
    const hasGluedFourDigitPairRun =
      !hasPlayPrefix &&
      !hasPickMarker &&
      !hasMbMarker &&
      toks.length === 4 &&
      toks.some((s) => s.length === 4) &&
      toks.filter((s) => s.length <= 2).length === 3 &&
      !/[$€£]|\/|:|-|\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/i.test(norm);
    const hasBareFiveMains =
      !hasPlayPrefix &&
      !hasPickMarker &&
      !hasMbMarker &&
      /^\s*(\d{1,2}\s+){4}\d{1,2}\s*$/.test(stripped) &&
      !/[$€£]|\/|:|-|\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/i.test(norm);
    if (!hasPlayPrefix && !hasPickMarker && !hasMbMarker && !hasBareFiveMains && !hasGluedFourDigitPairRun) return false;
    const p = parseUsPbMmLine(t, mainCount, mainMax, specialMin, specialMax);
    return p.main.length >= mainCount;
  };

  const allSets: number[][] = [];
  const specialsPerLine: number[] = [];
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3);
  for (const line of lines) {
    if (allSets.length >= maxPlays) break;
    if (!isPlayLike(line)) continue;
    const { main, special } = parseUsPbMmLine(line, mainCount, mainMax, specialMin, specialMax);
    if (main.length >= mainCount) {
      allSets.push(main.slice(0, mainCount));
      specialsPerLine.push(special != null && special > 0 ? special : 0);
    }
  }
  return { allSets, specialsPerLine };
}

/**
 * Flat digit stream: repeated groups of (mainCount mains, then first following number in special range).
 * Used when blocks/lines collapse into one blob.
 */
function extractUsPbMmFromDigitStream(
  fullText: string,
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
  maxPlays: number,
): { allSets: number[][]; specialsPerLine: number[] } {
  // Digit-stream is a last-resort fallback; aggressively restrict to lines that look like actual play lines
  // to avoid polluting picks with dates/times/odds (which often contain in-range 1–2 digit tokens).
  const playishLines = fullText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((l) => {
      if (l.length < 3) return false;
      if (/\bODDS\b|\bPRINTED\b|\bRET#\b|\bDRAW\b|\bCASH\s+VALUE\b|\bEST\.\s*CASH\b/i.test(l)) return false;
      // Date/time lines are extremely numeric and often look like 5 mains; never treat them as play rows.
      if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(l)) return false;
      if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(l)) return false;
      if (/\b(?:FRI|SAT|SUN|MON|TUE|WED|THU)\b/i.test(l) && /\b20\d{2}\b/.test(l)) return false;
      const p = parseUsPbMmLine(l, mainCount, mainMax, specialMin, specialMax);
      if (p.main.length >= mainCount) return true;
      const norm = normalizeOcrOAsZeroAdjacentDigits(l);
      const stripped = stripUsPlayLineLetterPrefix(norm).replace(/\s+/g, ' ').trim();
      const toks = stripped.match(/\b\d{1,4}\b/g) ?? [];
      if (
        /^\s*(\d{1,2}\s+){4}\d{1,2}\s*$/.test(stripped) &&
        !/[$€£]|\/|:|-|\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/i.test(norm)
      )
        return true;
      if (
        toks.length === 4 &&
        toks.some((s) => s.length === 4) &&
        toks.filter((s) => s.length <= 2).length === 3 &&
        !/[$€£]|\/|:|-|\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/i.test(norm)
      )
        return true;
      return /^\s*[A-Z]\s*[\.\)]?\s*\d/.test(l);
    });
  const normalized = stripUsPlayLineLetterPrefix(playishLines.join(' ').replace(/\s+/g, ' '));
  let allDigits =
    normalized.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) ?? [];
  allDigits = mergeUsPbLeadingZeroPair(allDigits);
  allDigits = fixUsPbLeadingDigitNoise(allDigits);
  /** Trailing 2+5→25 is applied in parseUsPbMmLine per line only; digit-stream multi-play would mis-merge if done globally. */
  const allSets: number[][] = [];
  const specialsPerLine: number[] = [];
  let i = 0;
  while (allSets.length < maxPlays && i < allDigits.length) {
    const mains: number[] = [];
    const used = new Set<number>();
    while (i < allDigits.length && mains.length < mainCount) {
      const n = allDigits[i];
      if (n >= 1 && n <= mainMax && !used.has(n)) {
        mains.push(n);
        used.add(n);
      }
      i++;
    }
    if (mains.length < mainCount) break;
    let special = 0;
    while (i < allDigits.length) {
      const n = allDigits[i];
      if (n >= specialMin && n <= specialMax) {
        special = n;
        i++;
        break;
      }
      i++;
    }
    allSets.push(mains.sort((a, b) => a - b));
    specialsPerLine.push(special);
  }
  return { allSets, specialsPerLine };
}

/**
 * Matrix-reg heuristic: detect play lines by shape (5 mains, ascending, distinct),
 * without relying on QP/OP/MB markers. Then align specials using global labeled lists when present.
 * This is resilient when markers are noisy or far from mains.
 */
function extractUsPbMmFromMatrixLines(
  fullText: string,
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
  maxPlays: number,
): { allSets: number[][]; specialsPerLine: number[] } {
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const allSets: number[][] = [];
  const inlineSpecials: number[] = [];
  for (const rawLine of lines) {
    if (allSets.length >= maxPlays) break;
    // Avoid obvious noise: long IDs/serials/dates/times/money.
    if (/\b\d{3,}\b/.test(rawLine)) continue;
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(rawLine)) continue;
    if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(rawLine)) continue;
    if (/[$€£]/.test(rawLine)) continue;

    const norm = normalizeOcrOAsZeroAdjacentDigits(rawLine);
    const stripped = stripUsPlayLineLetterPrefix(norm);
    const p = parseUsPbMmLine(stripped, mainCount, mainMax, specialMin, specialMax);
    if (p.main.length !== mainCount) continue;
    // Shape constraints: ascending + distinct (tickets print mains sorted).
    const mains = p.main.slice(0, mainCount);
    const sorted = [...mains].sort((a, b) => a - b);
    const distinct = new Set(sorted).size === mainCount;
    const ascending = mains.every((n, i) => i === 0 || n >= mains[i - 1]!);
    if (!distinct) continue;
    if (!ascending) continue;
    if (!sorted.every((n) => n >= 1 && n <= mainMax)) continue;
    allSets.push(sorted);
    inlineSpecials.push(p.special != null && p.special >= specialMin && p.special <= specialMax ? p.special : 0);
  }

  const specialsPerLine: number[] = inlineSpecials.slice();
  if (!allSets.length) return { allSets, specialsPerLine };

  // Align specials from labeled lists (when present) without forcing adjacency.
  if (specialMax <= 26) {
    const pbList = extractPowerballsPerLineFromRawText(fullText);
    if (pbList.length) {
      for (let i = 0; i < specialsPerLine.length && i < pbList.length; i++) {
        if (specialsPerLine[i] && specialsPerLine[i]! > 0) continue;
        specialsPerLine[i] = pbList[i] ?? 0;
      }
    }
  } else if (specialMax <= 25) {
    const mbList = extractMegaBallsPerLineFromRawText(fullText);
    if (mbList.length) {
      for (let i = 0; i < specialsPerLine.length && i < mbList.length; i++) {
        if (specialsPerLine[i] && specialsPerLine[i]! > 0) continue;
        specialsPerLine[i] = mbList[i] ?? 0;
      }
    }
  }
  return { allSets, specialsPerLine };
}

function pickBestUsPbMm(
  text: string,
  blocks: Array<{ text: string; lines?: Array<{ text: string }> }> | undefined,
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
  maxPlays: number,
): { allSets: number[][]; specialsPerLine: number[] } | null {
  type Cand = { allSets: number[][]; specialsPerLine: number[]; w: number };
  const cands: Cand[] = [];
  const mx = extractUsPbMmFromMatrixLines(text, mainCount, mainMax, specialMin, specialMax, maxPlays);
  if (mx.allSets.length) cands.push({ ...mx, w: mx.allSets.length * 100 + 4 });
  if (blocks?.length) {
    const b = extractUsPbMmFromBlocks(blocks, mainCount, mainMax, specialMin, specialMax, maxPlays);
    if (b.allSets.length) cands.push({ ...b, w: b.allSets.length * 100 + 3 });
  }
  const ln = extractUsPbMmFromLinesText(text, mainCount, mainMax, specialMin, specialMax, maxPlays);
  if (ln.allSets.length) cands.push({ ...ln, w: ln.allSets.length * 100 + 2 });
  const st = extractUsPbMmFromDigitStream(text, mainCount, mainMax, specialMin, specialMax, maxPlays);
  if (st.allSets.length) cands.push({ ...st, w: st.allSets.length * 100 + 1 });
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.w - a.w || b.allSets.length - a.allSets.length);
  const best = cands[0];
  return { allSets: best.allSets, specialsPerLine: best.specialsPerLine };
}

function extractNumbers(
  text: string,
  mainCount: number,
  mainMax: number,
  specialMax: number,
  specialCount: number,
  blocks?: Array<{ text: string; lines?: Array<{ text: string }> }>
): { main: number[]; special: number[]; allSets: number[][] } {
  const cleaned = cleanTicketText(text);
  const allSets: number[][] = [];

  if (blocks?.length) {
    for (const block of blocks) {
      for (const line of block.lines ?? []) {
        const nums = extractNumbersFromLine(line.text, mainMax);
        if (nums.length >= mainCount) {
          allSets.push(nums.slice(0, mainCount));
        }
      }
    }
  }

  const nums = cleaned.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) ?? [];
  const main: number[] = [];
  const special: number[] = [];
  const used = new Set<number>();
  for (const n of nums) {
    if (main.length < mainCount && n >= 1 && n <= mainMax && !used.has(n)) {
      main.push(n);
      used.add(n);
    } else if (special.length < specialCount && n >= 1 && n <= specialMax && !used.has(n)) {
      special.push(n);
      used.add(n);
    }
  }
  return { main: main.sort((a, b) => a - b), special, allSets };
}

export type MlKitResult = {
  text: string;
  blocks?: Array<{ text: string; lines?: Array<{ text: string }> }>;
};

/** Exported for layered Powerball pipeline; keep signature in sync with ML Kit output. */
export function parseMlKitResultToTicket(
  result: MlKitResult,
  options: {
    mainCount: number;
    mainMax: number;
    specialMin?: number;
    specialMax: number;
    specialCount: number;
    lotteryId?: string;
    jurisdictionCode?: string;
    playsPerTicket?: number;
  },
): ParsedTicket | null {
  const text = result?.text ?? '';
  const normalizedText = stripDiacritics(text);
  const blocks = result?.blocks;
  if (!text.trim()) return null;

  const { mainCount, mainMax, specialMax, specialCount } = options;
  const smin = options.specialMin ?? 1;
  const plays = options.playsPerTicket ?? 5;

  let addOnsDetected: ParsedAddOns | undefined;
  if (options.lotteryId) {
    // Add-on detection should not depend on UI having a selected region.
    // Fall back to NATIONAL codes when missing/blank to keep logic consistent.
    const lot = options.lotteryId;
    const jcRaw = typeof options.jurisdictionCode === 'string' ? options.jurisdictionCode.trim() : '';
    const jc =
      jcRaw.length > 0
        ? jcRaw
        : lot === 'powerball' || lot === 'mega_millions'
          ? 'US-NATIONAL'
          : 'CA-NATIONAL';
    // Normalize diacritics for robust keyword matching (e.g. TAC/TẤC; French slips).
    addOnsDetected = extractAddOnsFromRawTicketText(normalizedText, lot, jc);
  }
  const drawDate = parseDateFromText(text);

  if (options.lotteryId === 'powerball' || options.lotteryId === 'mega_millions') {
    const picked = pickBestUsPbMm(text, blocks, mainCount, mainMax, smin, specialMax, plays);
    if (picked && picked.allSets.length > 0) {
      const { allSets: usSets, specialsPerLine } = picked;
      const spl = specialsPerLine.slice(0, usSets.length);
      return {
        mainNumbers: usSets[0],
        allSets: usSets,
        specialsPerLine: spl,
        drawDate,
        confidence: usSets[0].length >= mainCount ? 0.9 : 0.5,
        rawText: text,
        addOnsDetected,
      };
    }
  }

  // Canada Lotto Max / 6/49: parse by strict "mainCount numbers per line" structure, not generic digit-stream.
  if (options.lotteryId === 'lotto_max' || options.lotteryId === 'lotto_649') {
    const sets = extractCanadaMainSetsFromLinesText(normalizedText, mainCount, mainMax, Math.max(1, plays));
    if (sets.length) {
      return {
        mainNumbers: sets[0]!,
        allSets: sets,
        drawDate,
        confidence: sets[0]!.length >= mainCount ? 0.9 : 0.5,
        rawText: text,
        addOnsDetected,
      };
    }
  }

  const { main, special, allSets } = extractNumbers(text, mainCount, mainMax, specialMax, specialCount, blocks);
  if (main.length === 0 && (!allSets || allSets.length === 0)) return null;
  const useMain = allSets?.length ? allSets[0] : main;
  const useSpecial = mainCount === 7 && mainMax === 49 ? undefined : special.length > 0 ? special : undefined;
  return {
    mainNumbers: useMain,
    specialNumbers: useSpecial,
    allSets: allSets?.length ? allSets : undefined,
    drawDate,
    confidence: useMain.length >= mainCount ? 0.9 : 0.5,
    rawText: text,
    addOnsDetected,
  };
}

/** Heuristic score for picking best OCR among preprocessed variants (ML Kit has no per-line confidence). */
export function scoreParsedTicket(
  parsed: ParsedTicket | null,
  mainCount: number,
  mainMax: number,
  opts?: { lotteryId?: string; specialMin?: number; specialMax?: number },
): number {
  if (!parsed) return -1;
  const sets = parsed.allSets?.length ? parsed.allSets : [parsed.mainNumbers];
  let best = -1;
  for (const set of sets) {
    const valid = set.filter((n) => n >= 1 && n <= mainMax);
    let s = valid.length * 6;
    if (valid.length >= mainCount) s += 22;
    if (valid.length === mainCount) s += 40;
    s -= Math.abs(valid.length - mainCount) * 5;
    if (parsed.drawDate) s += 5;
    if (parsed.specialNumbers?.length) s += 5;
    if (parsed.specialsPerLine?.some((n) => n > 0)) s += 8;
    // PB/MM: penalize "mains" that look like date/time components (common OCR failure mode).
    if (parsed.rawText && (opts?.lotteryId === 'mega_millions' || opts?.lotteryId === 'powerball')) {
      const txt = parsed.rawText;
      const mDate = txt.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/);
      const mTime = txt.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
      if (mDate || mTime) {
        const bag = new Set<number>();
        if (mDate) {
          bag.add(parseInt(mDate[1]!, 10));
          bag.add(parseInt(mDate[2]!, 10));
          const y = parseInt(mDate[3]!, 10);
          if (y >= 0 && y <= 99) bag.add(y);
          if (y >= 2000 && y <= 2099) bag.add(y % 100);
        }
        if (mTime) {
          bag.add(parseInt(mTime[1]!, 10));
          bag.add(parseInt(mTime[2]!, 10));
          if (mTime[3]) bag.add(parseInt(mTime[3]!, 10));
        }
        const hits = valid.filter((n) => bag.has(n)).length;
        // If most of the "mains" are explainable by date/time, it's almost certainly wrong.
        if (hits >= Math.min(4, mainCount)) s -= 60;
      }
    }
    // PB/MM: strongly prefer variants that actually contain labeled specials in rawText.
    if (parsed.rawText && (opts?.lotteryId === 'mega_millions' || opts?.lotteryId === 'powerball')) {
      const smin = opts?.specialMin ?? 1;
      const smax = opts?.specialMax ?? 0;
      if (opts?.lotteryId === 'mega_millions') {
        const mbList = extractMegaBallsPerLineFromRawText(parsed.rawText);
        const mbOne = extractMegaBallFromRawText(parsed.rawText);
        if (mbList.length) s += 18;
        if (mbOne != null && mbOne >= smin && (smax ? mbOne <= smax : true)) s += 10;
      } else if (opts?.lotteryId === 'powerball') {
        const pbList = extractPowerballsPerLineFromRawText(parsed.rawText);
        const pbOne = extractPowerballFromRawText(parsed.rawText);
        if (pbList.length) s += 18;
        if (pbOne != null && pbOne >= smin && (smax ? pbOne <= smax : true)) s += 10;
      }
    }
    if (parsed.rawText && parsed.rawText.length > 40) s += 2;
    best = Math.max(best, s);
  }
  return best;
}

/**
 * Parse ticket numbers and optional draw date from image URI.
 * Uses expo-mlkit-ocr (local, free). Returns null on web or if OCR fails.
 * Runs lightweight preprocessing (CLAHE, background suppression, adaptive threshold + morphology),
 * then OCR on grayscale / region-enhanced / binarized variants and keeps the best parse by heuristic score.
 * When lotteryId and jurisdictionCode are provided, also extracts add-on data (EXTRA, ENCORE, TAG, Power Play, Double Play).
 */
export async function parseTicketFromImage(
  imageUri: string,
  options?: {
    mainCount: number;
    mainMax: number;
    specialMin?: number;
    specialMax: number;
    specialCount: number;
    lotteryId?: string;
    jurisdictionCode?: string;
    playsPerTicket?: number;
    /** Dev: called with copied URIs right before temp preprocess files are deleted. */
    debugPreprocessPreview?: (info: TicketPreprocessDebugInfo) => void;
    /** Set when the image comes from `react-native-document-scanner-plugin` (already flattened). */
    imageSource?: 'document_scan' | 'default';
  }
): Promise<ParsedTicket | null> {
  if (Platform.OS === 'web') return null;

  const mainCount = options?.mainCount ?? 7;
  const mainMax = options?.mainMax ?? 49;
  const specialMax = options?.specialMax ?? 49;
  const specialCount = options?.specialCount ?? 1;
  const lotteryId = (options?.lotteryId as LotteryId) ?? 'powerball';

  const parseOpts = {
    mainCount,
    mainMax,
    specialMin: options?.specialMin,
    specialMax,
    specialCount,
    lotteryId: options?.lotteryId,
    jurisdictionCode: options?.jurisdictionCode,
    playsPerTicket: options?.playsPerTicket,
  };

  const finalizeUsSpecials = (t: ParsedTicket | null) =>
    (finalizeUsGameSpecialsFromRawText(
      t,
      lotteryId,
      options?.specialMin ?? 1,
      options?.specialMax ?? specialMax,
    ) as ParsedTicket | null);

  const runOne = async (uri: string) => {
    const result = (await recognizeTicketText(uri)) as MlKitResult;
    return finalizeUsSpecials(parseMlKitResultToTicket(result, parseOpts));
  };

  if (lotteryId === 'powerball' && USE_LAYERED_POWERBALL_OCR) {
    try {
      const { runPowerballLayeredPipeline } = await import('./powerballOcr/pipeline');
      const layered = await runPowerballLayeredPipeline(imageUri, {
        ...parseOpts,
        debugPreprocessPreview: options?.debugPreprocessPreview,
        fromDocumentScan: options?.imageSource === 'document_scan',
      });
      if (layered) return finalizeUsSpecials(layered);
    } catch {
      /* fall through to generic preprocess */
    }
  }

  try {
    const pre = await preprocessTicketImageForOcr(imageUri, lotteryId, {
      fromDocumentScan: options?.imageSource === 'document_scan',
    });
    try {
      const results = await Promise.all(pre.variantUris.map((u) => recognizeTicketText(u)));
      let best: ParsedTicket | null = null;
      let bestScore = -1;
      let bestVariant: { label: string; uri: string; score: number } | null = null;
      for (let i = 0; i < results.length; i++) {
        const parsed = parseMlKitResultToTicket(results[i] as MlKitResult, parseOpts);
        const s = scoreParsedTicket(parsed, mainCount, mainMax, {
          lotteryId,
          specialMin: parseOpts.specialMin,
          specialMax: parseOpts.specialMax,
        });
        if (s > bestScore) {
          bestScore = s;
          best = parsed;
          bestVariant = { label: pre.labels?.[i] ?? `v${i}`, uri: pre.variantUris[i]!, score: s };
        }
      }
      // Also evaluate the original image OCR; sometimes preprocessing harms OCR for a specific ticket.
      const origResult = await recognizeTicketText(imageUri);
      const origParsed = parseMlKitResultToTicket(origResult as MlKitResult, parseOpts);
      const origScore = scoreParsedTicket(origParsed, mainCount, mainMax, {
        lotteryId,
        specialMin: parseOpts.specialMin,
        specialMax: parseOpts.specialMax,
      });

      const picked = origScore > bestScore ? origParsed : best;
      const pickedVariant =
        origScore > bestScore ? { label: 'original', uri: imageUri, score: origScore } : bestVariant;
      const pickedScore = Math.max(bestScore, origScore);

      if (picked) {
        const useMain = picked.mainNumbers;
        const confBoost = Math.min(0.95, 0.45 + pickedScore * 0.008);
        const withConf: ParsedTicket = {
          ...picked,
          confidence: useMain.length >= mainCount ? confBoost : picked.confidence,
        };
        if (typeof __DEV__ !== 'undefined' && __DEV__ && pickedVariant) {
          withConf.debugOcrVariant = pickedVariant;
        }
        return finalizeUsSpecials(withConf);
      }
      return await runOne(imageUri);
    } finally {
      if (options?.debugPreprocessPreview && pre.variantUris.length > 0) {
        try {
          const uris = await copyVariantUrisForDebug(pre.variantUris);
          options.debugPreprocessPreview({ uris, labels: pre.labels });
        } catch {
          /* ignore */
        }
      }
      await pre.cleanup();
    }
  } catch {
    /* fall through to single-shot OCR */
  }

  try {
    return await runOne(imageUri);
  } catch {
    return null;
  }
}
