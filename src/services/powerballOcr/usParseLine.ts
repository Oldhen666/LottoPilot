/**
 * US Powerball / Mega line parsing — same rules as ocr.ts parseUsPbMmLine, plus family hooks.
 */
import type { PbTemplateFamily } from './types';
import { PB_MAIN_COUNT, PB_MAIN_MAX, PB_SPECIAL_MAX, PB_SPECIAL_MIN } from './constants';

/**
 * Strip play-line letter (A/B/C…) before mains — CA tickets print "A" left of "04"; OCR often reads "A" as "1".
 * Also "A04" glued without space.
 */
export function stripUsPlayLineLetterPrefix(line: string): string {
  let t = line.replace(/\s+/g, ' ').trim();
  t = t.replace(/^\s*[A-Z]\s+(?=\d)/i, '');
  t = t.replace(/^\s*[A-Z](?=\d{1,2}\b)/i, '');
  return t.trim();
}

/**
 * When OCR emits 1 then 4 (from "A"+"04" or split "04"), merge to a single 4.
 * Exported for digit-stream path in ocr.ts.
 */
export function fixUsPbLeadingDigitNoise(raw: number[]): number[] {
  const arr = [...raw];
  if (arr.length >= 3 && arr[0] === 1 && arr[1] === 4 && arr[2] >= 10) {
    arr.splice(0, 2, 4);
  }
  return arr;
}

/**
 * OCR often splits "04" as 0 and 4; mains loop skips 0 so the 4 is lost and the next digit shifts wrong.
 */
export function mergeUsPbLeadingZeroPair(raw: number[]): number[] {
  if (raw.length >= 2 && raw[0] === 0 && raw[1] >= 1 && raw[1] <= 9) {
    return [raw[1], ...raw.slice(2)];
  }
  return raw;
}

/**
 * OCR splits "25" as 2 and 5; backward special scan picks 5 first. Merge last two if they form one special (10–26 PB, 10–25 Mega).
 */
export function mergeUsPbTrailingSpecialTwoDigits(
  raw: number[],
  specialMin: number,
  specialMax: number,
): number[] {
  if (raw.length < 2) return raw;
  const a = raw[raw.length - 2]!;
  const b = raw[raw.length - 1]!;
  const combo = a * 10 + b;
  if (combo >= 10 && combo <= specialMax && combo >= specialMin && a >= 1 && a <= 9 && b >= 0 && b <= 9) {
    return [...raw.slice(0, -2), combo];
  }
  return raw;
}

function scoreParsedLine(
  p: { main: number[]; special: number | null },
  mainCount: number,
  specialMin: number,
  specialMax: number,
): number {
  let s = p.main.length * 22;
  if (p.main.length === mainCount) s += 45;
  if (p.special != null && p.special >= specialMin && p.special <= specialMax) s += 35;
  if (p.main.length === mainCount && new Set(p.main).size !== mainCount) s -= 200;
  return s;
}

/** When raw had two 5s (or two 6s), prefer a parse that includes 6 (or 5) in mains — typical 5/6 OCR fix. */
function scoreDupFiveSixTieBreak(raw: number[], p: { main: number[]; special: number | null }): number {
  let b = 0;
  if (raw.filter((n) => n === 5).length >= 2 && p.main.some((n) => n === 6)) b += 4;
  if (raw.filter((n) => n === 6).length >= 2 && p.main.some((n) => n === 5)) b += 4;
  return b;
}

function scoreRepairCandidate(
  rawOriginal: number[],
  p: { main: number[]; special: number | null },
  mainCount: number,
  specialMin: number,
  specialMax: number,
): number {
  return (
    scoreParsedLine(p, mainCount, specialMin, specialMax) + scoreDupFiveSixTieBreak(rawOriginal, p)
  );
}

function isPerfectParsedLine(
  p: { main: number[]; special: number | null },
  mainCount: number,
  specialMin: number,
  specialMax: number,
): boolean {
  if (p.main.length !== mainCount) return false;
  if (new Set(p.main).size !== mainCount) return false;
  if (p.special == null || p.special < specialMin || p.special > specialMax) return false;
  return true;
}

/**
 * When OCR confuses 5 and 6, try flipping one digit at a time only if the baseline parse is imperfect
 * (low-confidence proxy: missing mains or special, or not already a perfect line).
 * Also retry when raw has duplicate 5 or duplicate 6 — otherwise a wrong 5th main (e.g. special 12) can look "perfect".
 */
function repairFiveSixAmbiguityRaw(
  raw: number[],
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
): number[] {
  const has56 = raw.some((n) => n === 5 || n === 6);
  if (!has56) return raw;

  const base = parseUsPbMmLineFromRaw(raw, mainCount, mainMax, specialMin, specialMax);
  const dupFiveInRaw = raw.filter((n) => n === 5).length >= 2;
  const dupSixInRaw = raw.filter((n) => n === 6).length >= 2;
  if (isPerfectParsedLine(base, mainCount, specialMin, specialMax) && !dupFiveInRaw && !dupSixInRaw) {
    return raw;
  }

  const baseScore = scoreRepairCandidate(raw, base, mainCount, specialMin, specialMax);
  let best = raw;
  let bestScore = baseScore;

  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]!;
    if (v !== 5 && v !== 6) continue;
    const alt = raw.slice();
    alt[i] = v === 5 ? 6 : 5;
    const p = parseUsPbMmLineFromRaw(alt, mainCount, mainMax, specialMin, specialMax);
    const sc = scoreRepairCandidate(raw, p, mainCount, specialMin, specialMax);
    if (sc > bestScore) {
      bestScore = sc;
      best = alt;
    }
  }
  return best;
}

/** Core digit-stream parse after string merges (used by repair and public API). */
function parseUsPbMmLineFromRaw(
  raw: number[],
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
): { main: number[]; special: number | null } {
  const mains: number[] = [];
  const used = new Set<number>();
  for (const n of raw) {
    if (mains.length < mainCount && n >= 1 && n <= mainMax && !used.has(n)) {
      mains.push(n);
      used.add(n);
    }
  }
  if (mains.length < mainCount) {
    return { main: mains.sort((a, b) => a - b), special: null };
  }
  let special: number | null = null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const n = raw[i];
    if (n < specialMin || n > specialMax) continue;
    if (!mains.includes(n)) {
      special = n;
      break;
    }
  }
  if (special == null) {
    for (let i = raw.length - 1; i >= 0; i--) {
      const n = raw[i];
      if (n >= specialMin && n <= specialMax) {
        special = n;
        break;
      }
    }
  }
  return { main: mains.sort((a, b) => a - b), special };
}

export function parseUsPbMmLine(
  line: string,
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
): { main: number[]; special: number | null } {
  const cleaned = stripUsPlayLineLetterPrefix(line);
  let raw = cleaned.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) ?? [];
  raw = mergeUsPbLeadingZeroPair(raw);
  raw = fixUsPbLeadingDigitNoise(raw);
  raw = mergeUsPbTrailingSpecialTwoDigits(raw, specialMin, specialMax);
  raw = repairFiveSixAmbiguityRaw(raw, mainCount, mainMax, specialMin, specialMax);
  return parseUsPbMmLineFromRaw(raw, mainCount, mainMax, specialMin, specialMax);
}

/** FL: PB12 / PB 12 style Powerball column. */
export function extractFlPowerballToken(text: string): number | null {
  const m = text.match(/\bPB\s*(\d{1,2})\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= PB_SPECIAL_MIN && n <= PB_SPECIAL_MAX) return n;
  }
  return null;
}

function stripFlPbPrefix(text: string): string {
  return text.replace(/\bPB\s*\d{1,2}\b/gi, ' ');
}

/** NY/IL/NJ: remove Quick Pick noise tokens before digit parse. */
export function stripQuickPickNoise(text: string): string {
  return text
    .replace(/\bQP\b/gi, ' ')
    .replace(/\bQ\s*P\b/gi, ' ')
    .replace(/\bQUICK\s*PICK\b/gi, ' ');
}

export function parsePowerballRowWithFamily(
  line: string,
  family: PbTemplateFamily,
): { main: number[]; special: number | null } {
  let t = line.replace(/\s+/g, ' ').trim();
  if (family === 'ny_il_nj') {
    t = stripQuickPickNoise(t);
  }
  if (family === 'fl') {
    const pb = extractFlPowerballToken(t);
    const rest = stripFlPbPrefix(t);
    const base = parseUsPbMmLine(rest, PB_MAIN_COUNT, PB_MAIN_MAX, PB_SPECIAL_MIN, PB_SPECIAL_MAX);
    if (pb != null && (base.special == null || base.special <= 0)) {
      return { main: base.main, special: pb };
    }
    return base;
  }
  return parseUsPbMmLine(t, PB_MAIN_COUNT, PB_MAIN_MAX, PB_SPECIAL_MIN, PB_SPECIAL_MAX);
}
