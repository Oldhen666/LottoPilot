/**
 * OCR / ticket image parsing via expo-mlkit-ocr (on-device, free).
 * Web: not supported, returns null. Native: ML Kit (Android) / Vision (iOS).
 */

import { Platform } from 'react-native';

/** Add-on data detected from OCR (auto-check when present) */
export interface ParsedAddOns {
  selected: Record<string, boolean>;
  inputs: Record<string, string>;
}

export interface ParsedTicket {
  mainNumbers: number[];
  specialNumbers?: number[];
  /** Multiple sets (e.g. Lotto Max has 3 lines) */
  allSets?: number[][];
  drawDate?: string; // YYYY-MM-DD if detected
  lotteryId?: string;
  confidence: number;
  /** Raw OCR text for date parsing / debugging */
  rawText?: string;
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
    const ExpoMlkitOcr = require('expo-mlkit-ocr').default;
    const result = await ExpoMlkitOcr.recognizeText(imageUri);
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

/** Extract add-on data from raw OCR text. Uses lotteryId/jurisdiction to know which add-ons apply. */
function extractAddOnsFromText(
  text: string,
  lotteryId: string,
  jurisdictionCode: string
): ParsedAddOns | undefined {
  const selected: Record<string, boolean> = {};
  const inputs: Record<string, string> = {};
  const lower = text.replace(/\s+/g, ' ').toLowerCase();

  // EXTRA / ENCORE: 7-digit number near keyword (OLG ENCORE, WCLC EXTRA). Skip if part of transaction ID (e.g. 40-5802-4769737-848).
  const sevenDigitMatches = [...text.matchAll(/\b(\d{7})\b/g)];
  for (const m of sevenDigitMatches) {
    const num = m[1];
    const idx = m.index!;
    const before = text.slice(Math.max(0, idx - 15), idx);
    const after = text.slice(idx + 7, idx + 25);
    if (/\d-\d{4}-\d$/.test(before) || /^-\d{3}/.test(after)) continue;
    const ctx = text.slice(Math.max(0, idx - 60), idx + 7 + 20).toLowerCase();
    if (/\bencore\b/.test(ctx)) {
      selected.ENCORE = true;
      inputs.ENCORE = num;
      break;
    }
    if (/\bextra\b/.test(ctx)) {
      selected.EXTRA = true;
      inputs.EXTRA = num;
      break;
    }
  }
  if (!selected.ENCORE && !selected.EXTRA && sevenDigitMatches.length > 0) {
    const m = sevenDigitMatches.find((x) => {
      const idx = x.index!;
      const before = text.slice(Math.max(0, idx - 15), idx);
      const after = text.slice(idx + 7, idx + 25);
      return !/\d-\d{4}-\d$/.test(before) && !/^-\d{3}/.test(after);
    });
    if (m) {
      const num = m[1];
      if (lotteryId === 'lotto_max' || lotteryId === 'lotto_649') {
        if (jurisdictionCode.startsWith('CA-ON')) {
          selected.ENCORE = true;
          inputs.ENCORE = num;
        } else if (['CA-AB', 'CA-SK', 'CA-MB'].some((j) => jurisdictionCode.startsWith(j))) {
          selected.EXTRA = true;
          inputs.EXTRA = num;
        }
      }
    }
  }

  // TAG: 6-digit number (ALC Atlantic)
  const sixDigit = text.match(/\b(\d{6})\b/g);
  if (sixDigit && ['CA-NB', 'CA-NS', 'CA-NL', 'CA-PE'].some((j) => jurisdictionCode.startsWith(j))) {
    const idx = text.toLowerCase().indexOf('tag');
    if (idx >= 0) {
      const afterTag = text.slice(idx, idx + 80);
      const m = afterTag.match(/\b(\d{6})\b/);
      if (m) {
        selected.TAG = true;
        inputs.TAG = m[1];
      }
    }
  }

  // Power Play / Double Play (Powerball)
  if (lotteryId === 'powerball') {
    if (/\bpower\s*play\b|powerplay\b/i.test(lower)) selected.POWER_PLAY = true;
    if (/\bdouble\s*play\b|doubleplay\b/i.test(lower)) selected.DOUBLE_PLAY = true;
  }

  if (Object.keys(selected).length === 0) return undefined;
  return { selected, inputs };
}

/** Exclude transaction ID (e.g. 40-5802-4769737-848-00) and EXTRA (2777382) */
function cleanTicketText(text: string): string {
  return text
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}-\d{4}-\d{7}-\d{3}-\d{2}\b/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .trim();
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

/**
 * Parse ticket numbers and optional draw date from image URI.
 * Uses expo-mlkit-ocr (local, free). Returns null on web or if OCR fails.
 * When lotteryId and jurisdictionCode are provided, also extracts add-on data (EXTRA, ENCORE, TAG, Power Play, Double Play).
 */
export async function parseTicketFromImage(
  imageUri: string,
  options?: {
    mainCount: number;
    mainMax: number;
    specialMax: number;
    specialCount: number;
    lotteryId?: string;
    jurisdictionCode?: string;
  }
): Promise<ParsedTicket | null> {
  if (Platform.OS === 'web') return null;
  try {
    const ExpoMlkitOcr = require('expo-mlkit-ocr').default;
    const result = await ExpoMlkitOcr.recognizeText(imageUri);
    const text = result?.text ?? '';
    const blocks = result?.blocks;
    if (!text.trim()) return null;

    const mainCount = options?.mainCount ?? 7;
    const mainMax = options?.mainMax ?? 49;
    const specialMax = options?.specialMax ?? 49;
    const specialCount = options?.specialCount ?? 1;

    const { main, special, allSets } = extractNumbers(text, mainCount, mainMax, specialMax, specialCount, blocks);
    const drawDate = parseDateFromText(text);

    let addOnsDetected: ParsedAddOns | undefined;
    if (options?.lotteryId && options?.jurisdictionCode) {
      addOnsDetected = extractAddOnsFromText(text, options.lotteryId, options.jurisdictionCode);
    }

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
  } catch {
    return null;
  }
}
