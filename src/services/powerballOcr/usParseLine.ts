/**
 * US Powerball / Mega line parsing — same rules as ocr.ts parseUsPbMmLine, plus family hooks.
 * DYE 1.0: letter noise stripped via rowOcrToDigitTokens before digit extraction.
 */
import { rowOcrToDigitTokens } from '../dye/rowOcrPostprocess';
import type { PbTemplateFamily } from './types';
import { PB_MAIN_COUNT, PB_MAIN_MAX, PB_SPECIAL_MAX, PB_SPECIAL_MIN } from './constants';

/** Mega Millions gold ball range (1–25). */
const MM_SPECIAL_MIN = 1;
const MM_SPECIAL_MAX = 25;

/** CA thermal / ML Kit: "08" often reads as "Dg" between other balls. */
function normalizeThermalLetterPairBalls(line: string): string {
  // "Dg" -> 08
  let t = line.replace(/\bDg\b/gi, '08');
  // FL: "MBZ3" -> "MB23" (Z misread as 2)
  t = t.replace(/\bMB\s*Z\s*(\d)\b/gi, 'MB 2$1');
  t = t.replace(/\bMBZ(\d)\b/gi, 'MB2$1');
  // FL: "Me01" / "ME01" -> "MB01" (E misread for B)
  t = t.replace(/\bM[Ee]\s*([0-2]?\d)\b/g, 'MB $1');
  t = t.replace(/\bM[Ee]([0-2]?\d)\b/g, 'MB $1');
  // FL: "M821" -> "MB21" (B misread/dropped; keep last 2 digits)
  t = t.replace(/\bM8(\d{2})\b/gi, 'MB $1');
  // FL: small "MB" column sometimes OCRs as "N23" or "Ma13" (MB23/MB13).
  t = t.replace(/\bN\s*([0-2]?\d)\b/gi, 'MB $1');
  t = t.replace(/\bMa\s*([0-2]?\d)\b/gi, 'MB $1');
  t = t.replace(/\bM\s*a\s*([0-2]?\d)\b/gi, 'MB $1');
  // FL: "MB23" can collapse to "vE3"/"ve3" (2+3 with MB lost/misread).
  t = t.replace(/\b[vV]\s*[Ee]\s*(\d)\b/g, 'MB 2$1');
  t = t.replace(/\b[vV][Ee](\d)\b/g, 'MB 2$1');

  // Powerball (FL): PB10 sometimes OCRs as "m10" or "ml0" (PB lost, 1→l, 0 kept).
  t = t.replace(/\b[mM]\s*10\b/g, 'PB10');
  t = t.replace(/\b[mM]\s*[lI1]\s*0\b/g, 'PB10');
  return t;
}

/**
 * When OCR drops the space between two white balls, DYE skips runs longer than 2 digits.
 * Example: "1424" → "14 24" (both in 1..mainMax). Avoid touching serial/date lines.
 */
function splitGluedFourDigitMainPairRuns(line: string, mainMax: number): string {
  const runs = line.match(/\d+/g) ?? [];
  const longRunCount = runs.filter((r) => r.length >= 4).length;
  // Avoid touching IDs / dates / serials (often contain separators or many long digit runs).
  // But allow play lines that legitimately have >4 numeric tokens (e.g. include special and multiplier).
  const looksPlayish =
    /^\s*[A-Z]\s*[\.\)]?\s*\d/.test(line) || /\b(?:QP|OP|GP|CP|AP|EP|0P|aP|oP)\b/i.test(line);
  if (/[-/]/.test(line) || (!looksPlayish && runs.length > 4) || longRunCount > 3) return line;

  return line.replace(/\b(\d{4})\b/g, (match, quad: string) => {
    if (/^20\d{2}$/.test(quad)) return match;
    const a = parseInt(quad.slice(0, 2), 10);
    const b = parseInt(quad.slice(2, 4), 10);
    if (a === b) return match;
    if (a < 1 || a > mainMax || b < 1 || b > mainMax) return match;
    return `${a} ${b}`;
  });
}

/** Normalize letter/symbol prefixes glued to digits: "P02" / "*05" / "&04" -> "02"/"05"/"04". */
function stripGluedPrefixNoiseToDigits(line: string): string {
  // Only strip when letters/symbols are directly glued to digits.
  return line.replace(/(?<!\d)([A-Za-z*&]+)(\d{1,2})\b/g, (full, pre: string, digits: string) => {
    const glued = `${pre}${digits}`;
    // Preserve PB/MM special-column glitches that we normalize later (e.g. "ml0" -> PB10).
    if (/^[mM]\s*(?:10|[lI1]0)$/.test(glued.replace(/\s+/g, ''))) return full;
    return digits;
  });
}

/**
 * Mega Millions: end-of-line glue like "70233X" means "70 23" plus a megaplier "3X".
 * We only need "70 23" for number parse; multiplier is handled elsewhere (add-on).
 */
function splitMegaGluedMainSpecialMultiplier(line: string): string {
  // 5 digits followed by X: aa bb cX  -> "aa bb"
  let t = line.replace(/\b(\d{2})(\d{2})(\d)[xX]\b/g, '$1 $2');
  // Standalone Megaplier tokens: "2X" / "3X" / "4X" / "5X" (not Mega Ball).
  t = t.replace(/\b[2-5][xX]\b/g, ' ');
  // "53P02" / "53P2" -> "53 02"
  t = t.replace(/(\d{2})\s*[Pp](\d{1,2})(?=[^0-9]|$)/g, '$1 $2');
  // "P2X" / "P02X" is Megaplier (not Mega Ball). Drop it entirely.
  t = t.replace(/\b[Pp]\d{1,2}[xX]\b/g, ' ');
  // "66*05" -> "66 05"
  t = t.replace(/(\d{2})\s*[*](\d{2})\b/g, '$1 $2');
  return t;
}

/**
 * ML Kit often reads white-ball zeros as letter O (and trailing 0 as O): O4→04, 6 O→60.
 * Only touches O/o as a token next to digits so headers like POWER stay unchanged.
 */
export function normalizeOcrOAsZeroAdjacentDigits(line: string): string {
  let t = line.replace(/\s+/g, ' ').trim();
  t = t.replace(/\b[Oo]\s+(\d)\b/g, '0$1');
  t = t.replace(/\b[Oo](\d)\b/g, '0$1');
  t = t.replace(/\b(\d)\s+[Oo]\b/g, '$10');
  t = t.replace(/\b(\d)[Oo]\b/g, '$10');
  return t;
}

/** Prefer digit-only line from DYE; fall back if OCR produced no digit runs. */
function dyeDigitLineForParse(stripped: string): string {
  let normalized = normalizeOcrOAsZeroAdjacentDigits(stripped);
  normalized = stripGluedPrefixNoiseToDigits(normalized);
  normalized = splitMegaGluedMainSpecialMultiplier(normalized);
  normalized = normalizeThermalLetterPairBalls(normalized);
  normalized = splitGluedFourDigitMainPairRuns(normalized, 70);
  const { textClean } = rowOcrToDigitTokens(normalized);
  return textClean.length > 0 ? textClean : normalized;
}

/**
 * Strip play-line letter (A/B/C…) before mains — CA tickets print "A" left of "04"; OCR often reads "A" as "1".
 * Also "A04" glued without space.
 */
export function stripUsPlayLineLetterPrefix(line: string): string {
  let t = line.replace(/\s+/g, ' ').trim();
  // Some slips prefix plays with a letter (A/B/...) and OCR can duplicate it ("QC", "SD", "OE").
  t = t.replace(/^\s*[A-Z]{1,2}\s+(?=\d)/i, '');
  // Also handle when the letter is glued to the first numeric token (can be 1–4 digits after OCR glue).
  t = t.replace(/^\s*[A-Z]{1,2}(?=\d)/i, '');
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
  let cutIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    const n = raw[i]!;
    if (mains.length < mainCount && n >= 1 && n <= mainMax && !used.has(n)) {
      mains.push(n);
      used.add(n);
      if (mains.length === mainCount && cutIdx < 0) {
        cutIdx = i;
      }
    }
  }
  if (mains.length < mainCount) {
    return { main: mains.sort((a, b) => a - b), special: null };
  }

  // Mega Millions: sometimes the gold ball is followed by a spurious "Q6"/"06" token (QP marker),
  // producing "... <MB> 06". If we have 2+ tail tokens and the last is a small digit, prefer the first tail token.
  if (specialMax === MM_SPECIAL_MAX && cutIdx >= 0) {
    const tail = raw.slice(cutIdx + 1).filter((n) => n >= specialMin && n <= specialMax);
    if (tail.length >= 2) {
      const last = tail[tail.length - 1]!;
      const prev = tail[tail.length - 2]!;
      if (last >= 1 && last <= 9 && prev >= specialMin && prev <= specialMax && !mains.includes(prev)) {
        return { main: mains.sort((a, b) => a - b), special: prev };
      }
    }
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
  // Only allow "special equals a main" (e.g. Mega 24 + white 24) when there is evidence of a
  // sixth ball on the line (NY quick-pick) — not when CA prints five mains only and Mega is elsewhere.
  if (special == null) {
    const hasDupInSpecialRange = raw.some(
      (n) => n >= specialMin && n <= specialMax && raw.filter((x) => x === n).length >= 2,
    );
    const hasExtraNumbers = raw.length > mainCount;
    if (hasDupInSpecialRange || hasExtraNumbers) {
      for (let i = raw.length - 1; i >= 0; i--) {
        const n = raw[i]!;
        if (n >= specialMin && n <= specialMax) {
          special = n;
          break;
        }
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
  const forDigits = dyeDigitLineForParse(cleaned);
  let raw = forDigits.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) ?? [];
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

/**
 * Some tickets print the Powerball number as a separate label line:
 * - "POWER 25"
 * - "POWERBALL 12"
 * Can be split by OCR across newlines or include noise like "POWE RAn".
 */
export function extractPowerballFromRawText(rawText: string): number | null {
  const t = rawText.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(/\bPOWER(?:\s*BALL)?\b[^0-9]{0,12}(\d{1,2})\b/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (Number.isFinite(n) && n >= PB_SPECIAL_MIN && n <= PB_SPECIAL_MAX) return n;
  return null;
}

/**
 * Some jurisdictions print one Powerball per play line as a list, e.g.:
 *   PB: 19 gp
 *   PB: 09 P
 * Extract in order for mapping onto specialsPerLine.
 */
export function extractPowerballsPerLineFromRawText(rawText: string): number[] {
  const out: number[] = [];
  const t = rawText.replace(/\r/g, '\n');
  const re = /\bPB\s*[:#]?\s*([0-9]{1,2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const n = parseInt(m[1]!, 10);
    if (!Number.isFinite(n)) continue;
    if (n >= PB_SPECIAL_MIN && n <= PB_SPECIAL_MAX) out.push(n);
  }
  return out;
}

function expandOcrDigitToken(tok: string): number[] {
  const s = tok.replace(/\D/g, '');
  if (!s) return [];
  if (s.length <= 2) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? [n] : [];
  }
  // Common OCR glue: "680" -> 68 + trailing 0 noise (ignore the 0).
  if (s.length === 3 && s.endsWith('0')) {
    const a = parseInt(s.slice(0, 2), 10);
    if (Number.isFinite(a) && a >= 1 && a <= 70) return [a];
  }
  // "244" / "251": Mega Ball 1–25 glued to a trailing digit (QP / glyph bleed); do not emit the tail as a second pick.
  if (s.length === 3) {
    const head2 = parseInt(s.slice(0, 2), 10);
    const d3 = s[2]!;
    if (
      Number.isFinite(head2) &&
      head2 >= MM_SPECIAL_MIN &&
      head2 <= MM_SPECIAL_MAX &&
      d3 >= '1' &&
      d3 <= '9'
    ) {
      return [head2];
    }
  }
  // Common OCR glue: "680" -> 68 + 0 (drop trailing 0), or "042" -> 04 + 2 (rare).
  const a = parseInt(s.slice(0, 2), 10);
  const b = parseInt(s.slice(2), 10);
  const out: number[] = [];
  if (Number.isFinite(a)) out.push(a);
  if (Number.isFinite(b)) out.push(b);
  return out;
}

/**
 * NY-style Mega Millions quick pick line often OCRs as:
 *   "03 24. 42 58 680 24 oP"
 * where the gold ball is the last 1..25 token after the 5 white balls, with QP noise.
 */
function extractMegaBallFromQuickPickMessyLine(rawText: string): number | null {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const norm = stripQuickPickNoise(normalizeOcrOAsZeroAdjacentDigits(line))
      .replace(/\s+/g, ' ')
      .trim();
    if (!norm) continue;
    if (/\bPB\b/i.test(norm)) continue;
    if (/\bMB\s*[:#]/i.test(norm)) continue;
    if (/\bMEGA\s*BALL\b|\bMEGABALL\b|(?<![A-Za-z])MEGA(?![A-Za-z])/i.test(norm)) continue;
    if (norm.length > 80) continue;

    const rawToks = norm.match(/\b\d{1,3}\b/g) ?? [];
    const nums: number[] = [];
    for (const tok of rawToks) {
      for (const n of expandOcrDigitToken(tok)) {
        if (Number.isFinite(n) && n >= 1 && n <= 70) nums.push(n);
      }
    }
    if (nums.length < 6) continue;

    const mains: number[] = [];
    const used = new Set<number>();
    for (const n of nums) {
      if (mains.length >= 5) break;
      if (n >= 1 && n <= 70 && !used.has(n)) {
        mains.push(n);
        used.add(n);
      }
    }
    if (mains.length !== 5) continue;

    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i]!;
      // Mega Ball can repeat a white-ball digit on the ticket (e.g. "24 ... 24 oP").
      // Prefer the last 1..25 token even if it duplicates an earlier white-ball pick.
      if (n >= MM_SPECIAL_MIN && n <= MM_SPECIAL_MAX) return n;
    }
  }
  return null;
}

/** Reject label captures where OCR glued the digit to $/S price or ticket id (e.g. MEGA S5., MEGA R102…). */
function shouldRejectMegaLabelDigitGlue(t: string, absFirstDigitOfCapture: number): boolean {
  if (absFirstDigitOfCapture <= 0) return false;
  const prev = t[absFirstDigitOfCapture - 1]!;
  if (/[Ss$]/.test(prev)) return true;
  if (/[A-Za-z]/.test(prev) && !/[Oo]/.test(prev)) return true;
  return false;
}

function absIndexOfCaptureGroup1(m: RegExpMatchArray): number {
  const full = m[0]!;
  const g1 = m[1]!;
  const rel = full.lastIndexOf(g1);
  return (m.index ?? 0) + (rel >= 0 ? rel : 0);
}

function tryExtractMegaBallFromLabelPatterns(t: string): number | null {
  const explicit = [
    /\bMEGA\s*BALL\b[^0-9]{0,12}(\d{1,2})\b/gi,
    /\bMEGABALL\b[^0-9]{0,12}(\d{1,2})\b/gi,
    /\bMB\b[^0-9]{0,4}(\d{1,2})\b/gi,
  ];
  for (const re of explicit) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const n = parseInt(m[1]!, 10);
      if (!Number.isFinite(n) || n < MM_SPECIAL_MIN || n > MM_SPECIAL_MAX) continue;
      return n;
    }
  }
  // Standalone "MEGA" + digits (CA column / split lines). Tighten glue: skip R102… / S5. / $5. false positives.
  const standalone = /(?<![A-Za-z])MEGA(?![A-Za-z])[^0-9]{0,12}(\d{1,2})\b/gi;
  standalone.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = standalone.exec(t))) {
    const n = parseInt(m[1]!, 10);
    if (!Number.isFinite(n) || n < MM_SPECIAL_MIN || n > MM_SPECIAL_MAX) continue;
    const absDigit = absIndexOfCaptureGroup1(m);
    if (shouldRejectMegaLabelDigitGlue(t, absDigit)) continue;
    return n;
  }
  return null;
}

/**
 * Mega Millions often prints the gold ball as:
 * - "MEGA BALL 12"
 * - "MEGABALL 12"
 * - "MB 12" / "MB: 12"
 */
export function extractMegaBallFromRawText(rawText: string): number | null {
  const t = normalizeOcrOAsZeroAdjacentDigits(rawText).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const fromLabels = tryExtractMegaBallFromLabelPatterns(t);
  if (fromLabels != null) return fromLabels;
  return extractMegaBallFromQuickPickMessyLine(rawText);
}

/**
 * Per-line Mega Ball list, similar to Powerball "PB: xx" lists.
 */
export function extractMegaBallsPerLineFromRawText(rawText: string): number[] {
  const out: number[] = [];
  // IMPORTANT: preserve newlines (per-play lists rely on line structure).
  const t = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => normalizeOcrOAsZeroAdjacentDigits(l))
    .join('\n');

  // Generic MB markers (including glued forms like "MB23" or "MBZ3").
  // Extract in appearance order for mapping. (Z is normalized to 2 in normalizeThermalLetterPairBalls.)
  const linesForMb = t
    .split('\n')
    .map((l) => normalizeThermalLetterPairBalls(l).replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const hasQ6Anywhere = linesForMb.some((l) => /\bQ6\b|\b06\b/i.test(l) || /\bMB\b/i.test(l) && /\b6\b/.test(l));
  const looksFlorida = /\bFLORIDA\b/i.test(rawText) && /\bMEGA\s*MILLIONS\b/i.test(rawText);

  for (let i = 0; i < linesForMb.length; i++) {
    const line = linesForMb[i]!;

    // FL: "MB23 Q6" can degrade to "MB3 6" (lost leading '2' + lost 'Q').
    // Only apply when it looks like a play line (has 5+ main-range tokens) and in Florida context.
    if (looksFlorida) {
      const mbLost2 = line.match(/\bMB\s*([1-5])\b(?:\s*(?:Q?6|6)\b)/i);
      if (mbLost2) {
        const mains = (line.match(/\b\d{1,2}\b/g) ?? [])
          .map((s) => parseInt(s, 10))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 70);
        if (mains.length >= 5) {
          out.push(20 + parseInt(mbLost2[1]!, 10));
          continue;
        }
      }
    }

    const m = line.match(/\bMB\s*[:#\.]?\s*([0-9]{1,2})\b/i);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (Number.isFinite(n) && n >= MM_SPECIAL_MIN && n <= MM_SPECIAL_MAX) out.push(n);
      continue;
    }
    // Some tickets print MB on its own line, followed by the value on the next line.
    if (/^\s*MB\s*[:#\.]?\s*$/i.test(line)) {
      // Sometimes a long ticket/account number line sits between "MB" and the value.
      for (let j = 1; j <= 4; j++) {
        const next = linesForMb[i + j] ?? '';
        if (!next) continue;
        // Skip lines with 3+ consecutive digits (IDs, barcodes, timestamps).
        if (/\d{3,}/.test(next)) continue;
        const nm = next.match(/^\s*([0-9]{1,2})\b/);
        if (!nm) continue;
        const n = parseInt(nm[1]!, 10);
        if (Number.isFinite(n) && n >= MM_SPECIAL_MIN && n <= MM_SPECIAL_MAX) {
          out.push(n);
          break;
        }
      }
    }
  }

  const hasMegaMillionsContext = /\bMEGA\s*MILLIONS\b/i.test(rawText) || /\bMEGA\b/i.test(rawText);
  const hasQ6Near = (idx: number, span = 2): boolean => {
    const a = Math.max(0, idx - span);
    const b = Math.min(linesForMb.length - 1, idx + span);
    for (let k = a; k <= b; k++) {
      const l = linesForMb[k] ?? '';
      if (/\bQ6\b|\b06\b/i.test(l)) return true;
    }
    return false;
  };

  // FL: "MB13 Q6" sometimes OCRs as "w13 Q6" or "we13 s" (leading MB lost),
  // with Q6 drifting to a nearby line.
  for (let i = 0; i < linesForMb.length; i++) {
    const line = linesForMb[i]!;
    const m = line.match(/\b(?:[wW][Ee]?|[vV])\s*([0-2]?\d)\b/);
    if (!m) continue;
    // Keep this gated by Q6 presence (Florida marker), but do not require explicit "MEGA" text on the same OCR pass.
    if (!(hasQ6Anywhere || looksFlorida) || !(/\bQ6\b|\b06\b/i.test(line) || hasQ6Near(i, 2) || (looksFlorida && /\b6\b/.test(line)))) continue;
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n >= MM_SPECIAL_MIN && n <= MM_SPECIAL_MAX) out.push(n);
  }

  // FL: sometimes the MB value is a standalone "23" line, with Q6 elsewhere.
  for (let i = 0; i < linesForMb.length; i++) {
    const line = linesForMb[i]!;
    if (/^\s*[A-Z]\s*[\.\)]?\s*\d/i.test(line)) continue;
    const m = line.match(/^\s*([0-2]?\d)\s*$/);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (!Number.isFinite(n) || n < MM_SPECIAL_MIN || n > MM_SPECIAL_MAX) continue;
    if (!(hasQ6Anywhere && hasMegaMillionsContext && hasQ6Near(i, 3))) continue;
    out.push(n);
  }

  // Some tickets (e.g. WA) print a "MEGA BALL" column with per-line values:
  //   MEGA
  //   BALL
  //   10 QP 4X
  //   08 QP 2X
  // where OCR may emit "0P"/"(P" for QP/OP.
  const hasMegaBallColumn =
    /\bMEGA\s*BALL\b/i.test(t.replace(/\n+/g, ' ')) ||
    (/(^|\n)\s*MEGA\s*(\n|$)/i.test(t) && /(^|\n)\s*BALL\s*(\n|$)/i.test(t));
  if (hasMegaBallColumn) {
    for (const line of linesForMb) {
      // Skip play lines (handled elsewhere) and headers.
      if (/^\s*[A-Z]\s*[\.\)]?\s*\d/.test(line)) continue;
      if (/\bMEGA\b/i.test(line) && !/\bMB\b/i.test(line)) continue;
      if (/\bBALL\b/i.test(line)) continue;
      // "10 (P 4X" / "08 QP 2X" / "07 0P 3X"
      const m =
        line.match(/\b(\d{1,2})\s*(?:QP|OP|0P|\(P|aP|oP)\b/i) ||
        // If QP marker is missing, but multiplier exists, still treat as a Mega Ball column value.
        (/\b[2-5]X\b/i.test(line) ? line.match(/^\s*(\d{1,2})\b/) : null);
      if (!m) continue;
      const n = parseInt(m[1]!, 10);
      if (Number.isFinite(n) && n >= MM_SPECIAL_MIN && n <= MM_SPECIAL_MAX) out.push(n);
    }
  }

  // CA tickets often print per-play Mega Ball values as short "NN QP" lines near a standalone MEGA label.
  // Example:
  //   MEGA
  //   03 QP
  //   11 QP
  const hasStandaloneMega =
    !hasMegaBallColumn && /(^|\n)\s*MEGA\s*(\n|$)/i.test(t) && !/\bMEGA\s*MILLIONS\b/i.test(t);
  if (hasStandaloneMega) {
    const hasAnyQpMb = /\b\d{1,2}\s*QP\b/i.test(t);
    // Some CA prints "MEGA" on one line and the value on the next line (without QP marker).
    // Example:
    //   MEGA
    //   O3
    // We scan for a standalone MEGA line and take the next small numeric line (skip IDs).
    if (!hasAnyQpMb) {
      for (let i = 0; i < linesForMb.length; i++) {
        const line = linesForMb[i]!;
        if (!/^\s*MEGA\s*$/i.test(line)) continue;
        for (let j = 1; j <= 3; j++) {
          const next = linesForMb[i + j] ?? '';
          if (!next) continue;
          if (/\d{3,}/.test(next)) continue;
          const nm = normalizeOcrOAsZeroAdjacentDigits(next).match(/^\s*([0-9]{1,2})\b/);
          if (!nm) continue;
          const n = parseInt(nm[1]!, 10);
          if (Number.isFinite(n) && n >= MM_SPECIAL_MIN && n <= MM_SPECIAL_MAX) out.push(n);
          break;
        }
      }
    }

    const qpRe = /\b(\d{1,2})\s*QP\b/gi;
    let qm: RegExpExecArray | null;
    while ((qm = qpRe.exec(t))) {
      const n = parseInt(qm[1]!, 10);
      if (!Number.isFinite(n) || n < MM_SPECIAL_MIN || n > MM_SPECIAL_MAX) continue;
      out.push(n);
    }
  }

  // TX-style lettered play lines often contain the Mega Ball at the end:
  //   "A. 05 10 30 50 59 OP 02 QP"
  // And sometimes the 2nd/3rd MB appears as a trailing standalone "04 aP" line.
  // OCR often drops the leading "M" (e.g. "rEGABALL", "EGABALL"). Be tolerant here.
  // NOTE: do NOT key off "MEGA BALL" here — that's a different layout (WA column) handled above.
  const hasMegaBallHeader =
    /\bMEGABALL\b/i.test(t) || /\b[RM]?EGABALL\b/i.test(t);
  if (hasMegaBallHeader) {
    const lines = t
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const playLineSpecials: number[] = [];
    for (const line of lines) {
      const norm = stripQuickPickNoise(line).replace(/\s+/g, ' ').trim();
      if (!norm) continue;
      if (/\bODDS\b|\bPRINTED\b|\bRET#\b|\bDRAW\b/i.test(norm)) continue;
      const m = norm.match(/^\s*[A-Z]\s*[\.\)]?\s*(.+)$/);
      if (!m) continue;
      const parsed = parseUsPbMmLine(norm, 5, 70, MM_SPECIAL_MIN, MM_SPECIAL_MAX);
      if (parsed.main.length >= 5 && parsed.special != null && parsed.special > 0) {
        playLineSpecials.push(parsed.special);
      }
    }

    // Standalone suffix lines: "04 aP" / "06 QP" / "02 GP" etc.
    const suffixLineSpecials: number[] = [];
    for (const line of lines) {
      // IMPORTANT: do NOT stripQuickPickNoise here — it would remove "aP"/"oP" which are key suffix markers.
      const norm = normalizeOcrOAsZeroAdjacentDigits(line).replace(/\s+/g, ' ').trim();
      if (!norm) continue;
      if (/\bODDS\b|\bPRINTED\b|\bRET#\b|\bDRAW\b/i.test(norm)) continue;
      if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(norm)) continue;
      if (/\b(?:FRI|SAT|SUN|MON|TUE|WED|THU)\b/i.test(norm) && /\b20\d{2}\b/.test(norm)) continue;
      // OCR can emit "aP" (lowercase a) for QP/OP and "0P" for OP.
      const sm = norm.match(/\b(\d{1,2})\s*(?:0P|OP|QP|AP|GP|CP|aP|oP)\b/i);
      if (!sm) continue;
      const n = parseInt(sm[1]!, 10);
      if (!Number.isFinite(n) || n < MM_SPECIAL_MIN || n > MM_SPECIAL_MAX) continue;
      // Avoid re-adding the same value from a full play line.
      if (/^\s*[A-Z]\s*[\.\)]?\s*\d/.test(norm)) continue;
      suffixLineSpecials.push(n);
    }

    // Prefer play-line extracted specials; then append suffix lines (to fill missing rows).
    const combined = [...playLineSpecials, ...suffixLineSpecials];
    for (const n of combined) out.push(n);
  }
  return out;
}

function stripFlPbPrefix(text: string): string {
  return text.replace(/\bPB\s*\d{1,2}\b/gi, ' ');
}

/** NY/IL/NJ: remove Quick Pick noise tokens before digit parse. */
export function stripQuickPickNoise(text: string): string {
  return text
    .replace(/\bQP\b/gi, ' ')
    .replace(/\bQ\s*P\b/gi, ' ')
    .replace(/\bQUICK\s*PICK\b/gi, ' ')
    // e.g. "aQuICK PICK" (leading letter noise)
    .replace(/\ba\s*quick\s*pick\b/gi, ' ')
    // NY thermal OCR: "QP" → "ap" / "oP"
    .replace(/\bap\b/gi, ' ')
    .replace(/\bop\b/gi, ' ');
}

/**
 * Powerball / red ball column only (1–26). Does not scan the white-ball zone.
 * Prefer explicit "PB 12" when present (FL-style).
 */
export function parsePowerballSpecialFromColumnText(
  text: string,
  specialMin: number,
  specialMax: number,
): number | null {
  const fl = extractFlPowerballToken(text);
  if (fl != null) return fl;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const src = dyeDigitLineForParse(t);
  let nums = src.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)) ?? [];
  /** Scheme 2: same tail merge as full-line parse — PB column often splits "25" into 2 and 5. */
  nums = mergeUsPbLeadingZeroPair(nums);
  nums = fixUsPbLeadingDigitNoise(nums);
  nums = mergeUsPbTrailingSpecialTwoDigits(nums, specialMin, specialMax);
  for (let i = nums.length - 1; i >= 0; i--) {
    const n = nums[i]!;
    if (n >= specialMin && n <= specialMax) return n;
  }
  return null;
}

/**
 * White-ball zone only: first `mainCount` distinct picks in 1..mainMax from digit stream
 * (avoids treating the Powerball column as the sixth main).
 */
export function parseMainNumbersOnlyFromZoneText(
  line: string,
  family: PbTemplateFamily,
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
): number[] {
  let t = line.replace(/\s+/g, ' ').trim();
  if (family === 'ny_il_nj') {
    t = stripQuickPickNoise(t);
  }
  if (family === 'fl') {
    t = stripFlPbPrefix(t);
  }
  const cleaned = stripUsPlayLineLetterPrefix(t);
  const forDigits = dyeDigitLineForParse(cleaned);
  let raw = forDigits.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) ?? [];
  raw = mergeUsPbLeadingZeroPair(raw);
  raw = fixUsPbLeadingDigitNoise(raw);
  raw = mergeUsPbTrailingSpecialTwoDigits(raw, specialMin, specialMax);
  raw = repairFiveSixAmbiguityRaw(raw, mainCount, mainMax, specialMin, specialMax);
  const mains: number[] = [];
  const used = new Set<number>();
  for (const n of raw) {
    if (mains.length >= mainCount) break;
    if (n >= 1 && n <= mainMax && !used.has(n)) {
      mains.push(n);
      used.add(n);
    }
  }
  return mains.sort((a, b) => a - b);
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
