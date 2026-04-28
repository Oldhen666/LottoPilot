import {
  extractMegaBallsPerLineFromRawText,
  extractMegaBallFromRawText,
  extractPowerballFromRawText,
  extractPowerballsPerLineFromRawText,
  normalizeOcrOAsZeroAdjacentDigits,
  parseUsPbMmLine,
  stripQuickPickNoise,
} from './usParseLine';

type FinalizableTicket = {
  mainNumbers: number[];
  specialNumbers?: number[];
  specialsPerLine?: number[];
  allSets?: number[][];
  rawText?: string;
};

function normalizeLineForDigitParsing(line: string): string {
  // Fix common OCR quirks for small numeric tokens used on tickets.
  // - O7 / 6O: handled by normalizeOcrOAsZeroAdjacentDigits
  // - Prefix letters glued to digits: "PB07", "re07" -> "07"
  const t = normalizeOcrOAsZeroAdjacentDigits(line);
  // Only strip when letters are directly glued to digits (no whitespace), so we don't destroy headers like "PWR 10".
  return t.replace(/(?<!\d)[A-Za-z]{1,3}(\d{1,2})\b/g, '$1');
}

function extractInlinePbValueFromLine(line: string): number | null {
  // Florida sometimes prints "... PB26 QG" and OCR may emit it as "PR2606" (PB→PR, QG→06).
  // Prefer grabbing the first 2-digit group right after P[B/R], even if more digits follow.
  const norm = normalizeOcrOAsZeroAdjacentDigits(line);
  const m =
    norm.match(/(?:^|[^A-Z0-9])P[BR]\s*[:#]?\s*([0-2]?\d)\b/i) ||
    norm.match(/(?:^|[^A-Z0-9])P[BR]\s*([0-2]\d)(?=\d{2}\b)/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n < 1 || n > 26) return null;
  return n;
}

function extractNySplitColumnPlaysFromRawText(
  rawText: string,
): { mains: number[]; special: number }[] {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const upperAll = rawText.toUpperCase();
  const looksNy = upperAll.includes('NEW YORK') && upperAll.includes('POWERPLAY');
  if (!looksNy) return [];

  // Left zone (before NEW YORK header): OCR often breaks rows:
  // - A–E: 3 numbers per line (first 3 white balls)
  // - F–J: 4 numbers per line (first 4 white balls)
  // We collect numeric groups in order and keep first 10 groups.
  const nyHeaderIdx = lines.findIndex((l) => l.toUpperCase().includes('NEW YORK'));
  const leftRows: number[][] = [];
  for (let i = 0; i < (nyHeaderIdx >= 0 ? nyHeaderIdx : lines.length); i++) {
    const line = lines[i]!;
    const norm = normalizeLineForDigitParsing(line);
    const m = norm.match(/^\s*([A-J])\s*[\.\)]?\s*(.+)$/i);
    const tail = (m ? m[2] : norm).trim();
    const toks = tail.match(/\b\d{1,2}\b/g) ?? [];
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 69);
    if (nums.length >= 3 && nums.length <= 5) {
      leftRows.push(nums.slice(0, 5));
      if (leftRows.length >= 10) break;
    }
  }

  // Right zone (between POWERPLAY and draw date): contains the missing white balls
  // for each row (typically the last 2, but OCR may split one-per-line).
  const rightPairs: number[][] = [];
  const afterPowerplayIdx = lines.findIndex((l) => l.toUpperCase().includes('POWERPLAY'));
  if (afterPowerplayIdx < 0) return [];
  const rightAllNums: number[] = [];
  const suffixSinglesAll: number[] = [];
  const pendingFirsts: number[] = [];
  for (let i = afterPowerplayIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const norm = normalizeLineForDigitParsing(line);
    if (norm.toUpperCase().includes('SAT ') || norm.toUpperCase().includes('SUN ') || norm.toUpperCase().includes('MON ')) break;
    const hasSuffix = /\b(OP|OR|AR|AP)\b/i.test(norm);
    const toks = norm.match(/\b\d{1,2}\b/g) ?? [];
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 69);
    if (nums.length === 0 || nums.length > 2) continue;
    rightAllNums.push(...nums);
    if (nums.length === 2) {
      rightPairs.push([nums[0]!, nums[1]!]);
    } else if (nums.length === 1) {
      if (hasSuffix) {
        suffixSinglesAll.push(nums[0]!);
        if (pendingFirsts.length > 0) {
          rightPairs.push([pendingFirsts.shift()!, nums[0]!]);
        }
      } else {
        pendingFirsts.push(nums[0]!);
      }
    }
  }

  // Specials: scan after draw-date section for 1..26 tokens, favor "11 OP" style.
  const specials: number[] = [];
  const startIdx = Math.max(
    0,
    lines.findIndex((l) => l.toUpperCase().includes('SAT ')),
  );
  for (let i = startIdx; i < lines.length; i++) {
    const l = lines[i]!;
    const norm = normalizeLineForDigitParsing(l);
    if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(norm)) continue;
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(norm)) continue;
    if (/\d{3,}/.test(norm)) continue;
    const m = norm.match(/\b(\d{1,2})\s*(OP|OR|AR|AP)\b/i);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n >= 1 && n <= 26) specials.push(n);
      continue;
    }
    // Standalone "23" lines also appear in this area.
    const toks = norm.match(/^\s*(\d{1,2})\s*$/);
    if (toks) {
      const n = parseInt(toks[1]!, 10);
      if (n >= 1 && n <= 26) specials.push(n);
    }
  }

  const plays = leftRows.length;
  if (plays < 6) return []; // avoid false positives; NY tickets typically have many lines

  // Use first 5 full right pairs for A–E when available (2 numbers each).
  const firstFivePairs = rightPairs.slice(0, 5);
  const usedFirstTen = firstFivePairs.flat().slice(0, 10);
  const remainingRight = rightAllNums.slice();
  // Drop the first ten right numbers consumed by A–E.
  for (const n of usedFirstTen) {
    const idx = remainingRight.indexOf(n);
    if (idx >= 0) remainingRight.splice(idx, 1);
  }
  // Suffix singles after C/D pairing typically correspond to the missing last numbers for F–J.
  const suffixSingles = suffixSinglesAll.slice();
  // Remove suffix singles that were already used as second elements in the first five pairs.
  const usedSuffix = new Set<number>(firstFivePairs.map((p) => p[1]!).filter(Boolean));
  const suffixAfter = suffixSingles.filter((n) => !usedSuffix.has(n));

  const out: { mains: number[]; special: number }[] = [];
  let suffixIdx = 0;
  const usedAnyCounts = new Map<number, number>();
  const bumpUsed = (n: number) => usedAnyCounts.set(n, (usedAnyCounts.get(n) ?? 0) + 1);
  for (const n of usedFirstTen) bumpUsed(n);
  const suffixCounts = new Map<number, number>();
  for (const n of suffixAfter) suffixCounts.set(n, (suffixCounts.get(n) ?? 0) + 1);
  const usedFromSuffix = new Map<number, number>();
  for (let i = 0; i < plays; i++) {
    const base = (leftRows[i] ?? []).filter((n) => Number.isFinite(n) && n >= 1 && n <= 69).slice(0, 5);
    const need = Math.max(0, 5 - base.length);
    const extras: number[] = [];
    if (i < 5) {
      const pair = firstFivePairs[i] ?? [];
      extras.push(...pair);
      for (const n of pair) if (Number.isFinite(n)) bumpUsed(n);
    } else if (need > 0) {
      // Rows with 4 nums (need 1): take from suffix list first (more reliable for the last white ball),
      // and remove it from remainingRight to keep G row aligned.
      if (need === 1) {
        while (suffixIdx < suffixAfter.length) {
          const cand = suffixAfter[suffixIdx]!;
          const totalInSuffix = suffixCounts.get(cand) ?? 0;
          const usedSuffixCnt = usedFromSuffix.get(cand) ?? 0;
          const usedAny = usedAnyCounts.get(cand) ?? 0;
          // If this suffix value is unique in suffix list and already used elsewhere, skip.
          if (totalInSuffix === 1 && usedAny > 0) {
            suffixIdx++;
            continue;
          }
          // If it appears multiple times, allow up to that count.
          if (usedSuffixCnt >= totalInSuffix) {
            suffixIdx++;
            continue;
          }
          break;
        }
      }
      if (need === 1 && suffixIdx < suffixAfter.length) {
        const s = suffixAfter[suffixIdx++]!;
        extras.push(s);
        usedFromSuffix.set(s, (usedFromSuffix.get(s) ?? 0) + 1);
        bumpUsed(s);
        const idx = remainingRight.indexOf(s);
        if (idx >= 0) remainingRight.splice(idx, 1);
      } else {
        while (extras.length < need && remainingRight.length > 0) {
          const v = remainingRight.shift()!;
          extras.push(v);
          bumpUsed(v);
        }
      }
    }
    const combined = [...base, ...extras]
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 69)
      .slice(0, 5)
      .sort((a, b) => a - b);
    const mains = [...combined, ...Array(Math.max(0, 5 - combined.length)).fill(0)].slice(0, 5);
    const sp = specials[i] != null ? specials[i]! : 0;
    out.push({ mains, special: sp });
  }
  return out;
}

function extractNyMegaMillionsSplitColumnPlaysFromRawText(
  rawText: string,
): { mains: number[]; special: number }[] {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => normalizeLineForDigitParsing(l).trim())
    .filter(Boolean);

  // Heuristic: NY Mega Millions tickets commonly include nylottery URL.
  const upperAll = rawText.toUpperCase();
  const looksNy = upperAll.includes('NYLOTTERY') && upperAll.includes('MEGA');
  if (!looksNy) return [];

  // Collect A–E: first 4 white balls often appear on the lettered line.
  const left: { idx: number; mains4: number[] }[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-E])\s*[\.\)]?\s*(.+)$/i);
    if (!m) continue;
    const idx = m[1]!.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    const toks = (m[2] ?? '').match(/\b\d{1,2}\b/g) ?? [];
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 70);
    if (nums.length >= 3) left.push({ idx, mains4: nums.slice(0, 4) });
  }
  if (left.length < 3) return [];

  // Right column often OCRs as lines like: "34 oP 24 oP" = last white + MB
  // Sometimes the last white or MB is on a separate line; be lenient but keep order.
  const rightPairs: { last: number; mb: number }[] = [];
  const pendingPairIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Keep OP/QP markers; they are useful for spotting the right column pairs.
    const l = normalizeOcrOAsZeroAdjacentDigits(lines[i]!).replace(/\s+/g, ' ').trim();
    if (!l) continue;
    if (/\bODDS\b|\bPRINTED\b|\bRET#\b|\bDRAW\b|\bCASH\s+VALUE\b/i.test(l)) continue;
    if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(l)) continue;
    if (/\b\d{5,}\b/.test(l)) continue;

    // Accept OCR variants: oP/0P/(P/aP/oP and occasional oF (P misread as F).
    const tokenRe = /\b(\d{1,2})\s*(?:0P|OP|QP|AP|GP|CP|aP|oP|oF|\(P)\b/gi;
    const toks: number[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(l))) {
      const n = parseInt(tm[1]!, 10);
      if (!Number.isFinite(n)) continue;
      toks.push(n);
    }
    if (toks.length >= 2) {
      const a = toks[0]!;
      const b = toks[1]!;
      const last = a >= 1 && a <= 70 ? a : 0;
      const mb = b >= 1 && b <= 25 ? b : 0;
      if (last > 0 && mb > 0) {
        rightPairs.push({ last, mb });
      }
      continue;
    }
    if (toks.length === 1) {
      const n = toks[0]!;
      // If it's a white-ball-like value, append a placeholder pair and remember its index until we see a MB value.
      if (n > 25 && n <= 70) {
        rightPairs.push({ last: n, mb: 0 });
        pendingPairIdx.push(rightPairs.length - 1);
        continue;
      }
      // If it's a MB-like value and we have pending placeholder pairs, fill the earliest pending.
      if (n >= 1 && n <= 25 && pendingPairIdx.length > 0) {
        const idx = pendingPairIdx.shift()!;
        const cur = rightPairs[idx];
        if (cur && cur.last > 0 && cur.mb === 0) cur.mb = n;
      }
    }
  }
  if (rightPairs.length < 2) return [];

  // Combine in A–E order; fill missing with 0.
  const out: { mains: number[]; special: number }[] = [];
  const leftByIdx = new Map<number, number[]>();
  for (const r of left) leftByIdx.set(r.idx, r.mains4);
  for (let i = 0; i < 5; i++) {
    const m4 = leftByIdx.get(i) ?? [];
    const rp = rightPairs[i];
    const last = rp?.last ?? 0;
    const mb = rp?.mb ?? 0;
    const mains = [...m4, last].filter((n) => n >= 1 && n <= 70);
    const padded = [...mains, ...Array(Math.max(0, 5 - mains.length)).fill(0)].slice(0, 5).sort((a, b) => a - b);
    out.push({ mains: padded, special: mb });
  }
  return out;
}

function isValidDistinctMainSet(nums: number[], mainCount: number, mainMax: number): boolean {
  if (nums.length !== mainCount) return false;
  if (new Set(nums).size !== mainCount) return false;
  return nums.every((n) => n >= 1 && n <= mainMax);
}

/**
 * Some tickets have clean play lines in rawText even when spatial parsing goes off the rails.
 * Try to recover full play lines from rawText.
 */
function extractPowerballPlayLinesFromRawText(rawText: string): { mains: number[]; special: number }[] {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => normalizeLineForDigitParsing(l).trim())
    .filter(Boolean);

  const candidates: { mains: number[]; special: number; score: number }[] = [];

  for (const line of lines) {
    // Exclude date/time/metadata lines that contain many small numbers (e.g. "01/06/2016 18:25:59").
    const upper = line.toUpperCase();
    if (upper.includes('PRINTED')) continue;
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(line)) continue;
    if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(line)) continue;
    if (/\b(20\d{2})\b/.test(line)) continue;

    // Look for at least 6 number tokens on the line; keep it strict to avoid barcode/account numbers.
    const toks = line.match(/\b\d{1,2}\b/g);
    if (!toks || toks.length < 6) continue;
    // Prefer lines that look like "01 25 27 40 47 07"
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
    if (nums.length < 6) continue;

    // mains = first 5 distinct 1..69, special = last valid 1..26 not in mains
    const mains: number[] = [];
    const used = new Set<number>();
    for (const n of nums) {
      if (mains.length >= 5) break;
      if (n >= 1 && n <= 69 && !used.has(n)) {
        mains.push(n);
        used.add(n);
      }
    }
    if (!isValidDistinctMainSet(mains, 5, 69)) continue;

    let special: number | null = extractInlinePbValueFromLine(line);
    if (special != null && used.has(special)) special = null;
    for (let i = nums.length - 1; i >= 0 && special == null; i--) {
      const n = nums[i]!;
      if (n >= 1 && n <= 26 && !used.has(n)) {
        special = n;
        break;
      }
    }
    if (special == null) continue;

    // Score: prefer exactly 6 tokens, and special at end.
    let score = 0;
    if (toks.length === 6) score += 10;
    if (nums[nums.length - 1] === special) score += 8;
    score += mains.length * 2;
    candidates.push({ mains: mains.slice().sort((a, b) => a - b), special, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates.slice(0, 10);
  const out: { mains: number[]; special: number }[] = [];
  for (const c of best) {
    // Avoid duplicates
    if (out.some((o) => o.special === c.special && o.mains.join(',') === c.mains.join(','))) continue;
    out.push({ mains: c.mains, special: c.special });
  }
  return out;
}

/**
 * Common Powerball format: a full play line contains both mains and an inline "PB:" token:
 *   "38 58 59 65 55 AP PB: 02 QP"
 * This is the most reliable signal and avoids accidentally parsing metadata lines.
 */
function extractPowerballPlaysFromInlinePbLines(rawText: string): { mains: number[]; special: number }[] {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const out: { mains: number[]; special: number }[] = [];
  for (const line of lines) {
    const norm = normalizeLineForDigitParsing(line);
    if (!/\bPB\s*[:#]/i.test(norm)) continue;
    const upper = norm.toUpperCase();
    if (upper.includes('PRINTED')) continue;
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(norm)) continue;
    if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(norm)) continue;
    if (/\d{3,}/.test(norm)) continue; // avoid long ID lines

    const toks = norm.match(/\b\d{1,2}\b/g);
    if (!toks || toks.length < 6) continue;
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));

    const mains: number[] = [];
    const used = new Set<number>();
    for (const n of nums) {
      if (mains.length >= 5) break;
      if (n >= 1 && n <= 69 && !used.has(n)) {
        mains.push(n);
        used.add(n);
      }
    }
    if (!isValidDistinctMainSet(mains, 5, 69)) continue;

    // PB is usually the last 1..26 on the line after PB:
    let special: number | null = null;
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i]!;
      if (n >= 1 && n <= 26 && !used.has(n)) {
        special = n;
        break;
      }
    }
    if (special == null) continue;

    const mainsSorted = mains.slice().sort((a, b) => a - b);
    if (out.some((o) => o.special === special && o.mains.join(',') === mainsSorted.join(','))) continue;
    out.push({ mains: mainsSorted, special });
  }
  return out;
}

/**
 * Michigan-style (and some other) tickets print plays as lettered rows (A., B., C...)
 * and put Powerball values in a separate "PWR" column/list elsewhere.
 */
function extractLetteredPowerballPlays(rawText: string): { mains: number[]; special?: number }[] {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const byLetter = new Map<string, { mains: number[]; special?: number }>();
  for (const line of lines) {
    const norm = normalizeLineForDigitParsing(line);
    const m =
      // Most common: "A. 16 18 54 59 67" or "A) 16 18 ..."
      norm.match(/^\s*([A-E])\s*[\.\)]\s*(.+)$/i) ||
      // Sometimes OCR drops the dot or misplaces spaces: "A 16 18 54 59 67"
      norm.match(/^\s*([A-E])\s+(?=\d)(.+)$/i) ||
      // Most permissive: "A. <digits...>" or "A <digits...>" (ignores any noise between)
      norm.match(/^\s*([A-E])\s*[\.\)]?\s*([0-9].+)$/i);
    if (!m) continue;
    const letter = (m[1] ?? '').toUpperCase();
    const tail = m[2] ?? '';
    const toks = tail.match(/\b\d{1,2}\b/g) ?? [];
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
    const mains: number[] = [];
    const used = new Set<number>();
    for (const n of nums) {
      if (mains.length >= 5) break;
      if (n >= 1 && n <= 69 && !used.has(n)) {
        mains.push(n);
        used.add(n);
      }
    }
    if (!isValidDistinctMainSet(mains, 5, 69)) continue;

    // Some OCR variants append the Powerball at the end of the same line (e.g. "... EP 26 EP"),
    // or render PB column token as "PR2606" (PB26 + noise).
    let special: number | undefined;
    const inlinePb = extractInlinePbValueFromLine(norm);
    if (inlinePb != null && !used.has(inlinePb)) special = inlinePb;
    for (let i = nums.length - 1; i >= 0 && special == null; i--) {
      const n = nums[i]!;
      if (n >= 1 && n <= 26 && !used.has(n)) {
        special = n;
        break;
      }
    }
    byLetter.set(letter, { mains: mains.slice().sort((a, b) => a - b), special });
  }
  const order = ['A', 'B', 'C', 'D', 'E'];
  return order.map((k) => byLetter.get(k)).filter(Boolean) as { mains: number[]; special?: number }[];
}

function extractPwrListFromRawText(rawText: string): number[] {
  // Some OCR variants render "10" as "1O"/"1Ơ"/"1Ở". Normalize before tokenizing.
  const t = normalizeLineForDigitParsing(rawText)
    .replace(/\r/g, '\n')
    // Sometimes OCR keeps only the leading digit and a non-digit mark: "1Ở" → "1" + "Ở".
    // Treat any standalone "1<non-digit>" token as "10" to match ticket semantics.
    .replace(/1[^\d\s]/g, '10')
    .replace(/\b1[OƠỞ]\b/g, '10');
  const idx = t.toUpperCase().indexOf('PWR');
  if (idx < 0) return [];
  const after = t.slice(idx);
  const toks = after.match(/\b\d{1,2}\b/g) ?? [];
  const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 26);
  // Dedup while keeping order (OCR may repeat).
  const out: number[] = [];
  for (const n of nums) {
    if (out.length >= 10) break; // safety cap
    out.push(n);
  }
  return out;
}

/**
 * Illinois-style tickets: the Powerball values are printed in a separate "Powerball" column and OCR often
 * emits them as standalone lines like "- 21 QP", "- 16 QP", "22 OP", "15 QP".
 * Collect these from the first rawText chunk (before the duplicate separator).
 */
function extractPowerballValuesFromQpOpLines(rawText: string): number[] {
  const firstPart = rawText.split('\n---\n')[0] ?? rawText;
  // Deliberately avoid heavy normalization here; some normalizers are optimized for play lines and can
  // accidentally distort short value-only lines. We only need to recognize digits + QP/OP.
  const t = firstPart.replace(/\r/g, '\n');
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const valuesBefore: number[] = [];
  const valuesAfter: number[] = [];

  // Find the Powerball header row (OCR may output as "Powerball").
  const headerIdx = lines.findIndex((l) => l.toLowerCase() === 'powerball' || l.toLowerCase().startsWith('powerball'));

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    // Avoid IDs / dates / times
    if (/\b(20\d{2})\b/.test(l)) continue;
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(l)) continue;
    if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(l)) continue;
    if (/\d{3,}/.test(l)) continue;

    // Illinois column values are typically standalone lines with only ONE number token, e.g. "- 21 QP", "22 OP".
    // Exclude play lines like "A. 16 18 54 59 67 OP" which have multiple number tokens.
    if (!/\b(QP|OP|GP)\b/i.test(l)) continue;
    const numToks = l.match(/\b\d{1,2}\b/g) ?? [];
    if (numToks.length !== 1) continue;
    const m = l.match(/\b(\d{1,2})\s*(QP|OP|GP)\b/i);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (!Number.isFinite(n) || n < 1 || n > 26) continue;
    if (headerIdx >= 0 && i > headerIdx) valuesAfter.push(n);
    else valuesBefore.push(n);
  }

  // Heuristic for a common OCR ordering glitch:
  // One value (often the 2nd play) may appear before the "Powerball" header, while the rest appear after.
  // In that case, keep the first after-header value as play A, then insert all before-header values, then the remaining after-header values.
  if (valuesAfter.length > 0 && valuesBefore.length > 0) {
    return [valuesAfter[0]!, ...valuesBefore, ...valuesAfter.slice(1)];
  }
  return headerIdx >= 0 ? [...valuesBefore, ...valuesAfter] : valuesBefore;
}

// Test-only hooks (not used by app runtime directly).
export const __debug_extractPowerballValuesFromQpOpLines = extractPowerballValuesFromQpOpLines;
export const __debug_extractLetteredPowerballPlays = extractLetteredPowerballPlays;

function looksLikeNumberLineOnly(line: string): boolean {
  const norm = normalizeLineForDigitParsing(line);
  // Accept lines that are basically made of 1-2 digit tokens and separators.
  // Avoid dates (01/06/2016) and long numeric IDs.
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(norm)) return false;
  // Avoid time-only lines (18:25:59) which OCR may split out.
  if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(norm)) return false;
  if (/\d{3,}/.test(norm)) return false;
  const toks = norm.match(/\b\d{1,2}\b/g);
  if (!toks || toks.length === 0) return false;

  // Some OCR variants drop separators and emit date+time as pure small-number streams, e.g.
  // "01 06 20 16 18 25 59". Reject these to avoid treating them as play lines.
  if (toks.length >= 6) {
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
    const hasMonthDay = nums.length >= 2 && nums[0]! >= 1 && nums[0]! <= 12 && nums[1]! >= 1 && nums[1]! <= 31;
    const hasYearSplit = nums.includes(19) || nums.includes(20);
    const hasTwoDigitYearLike = nums.some((n) => n >= 15 && n <= 30);
    let hasTimeTriple = false;
    for (let i = 0; i + 2 < nums.length; i++) {
      const a = nums[i]!;
      const b = nums[i + 1]!;
      const c = nums[i + 2]!;
      if (a >= 0 && a <= 23 && b >= 0 && b <= 59 && c >= 0 && c <= 59) {
        hasTimeTriple = true;
        break;
      }
    }
    if (hasMonthDay && hasTimeTriple && (hasYearSplit || hasTwoDigitYearLike)) return false;
  }
  if (toks.length === 5) {
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
    if (
      nums.length === 5 &&
      nums[0]! >= 1 &&
      nums[0]! <= 12 &&
      nums[1]! >= 1 &&
      nums[1]! <= 31 &&
      nums[2]! >= 0 &&
      nums[2]! <= 23 &&
      nums[3]! >= 0 &&
      nums[3]! <= 59 &&
      nums[4]! >= 0 &&
      nums[4]! <= 59
    ) {
      return false;
    }
  }
  const cleaned = norm.replace(/\b\d{1,2}\b/g, '').replace(/[\s,.-]+/g, '');
  return cleaned.length === 0;
}

/**
 * Some tickets print mains across multiple lines, e.g.
 *   04 30 46
 *   58 59
 * Also PB may appear separately as "AP PB: 07 AP".
 * This tries to recover plays by concatenating consecutive numeric-only lines.
 */
function extractPowerballPlaysByConcatenatingNumberLines(
  rawText: string,
  specialsHint?: number[],
): { mains: number[]; special: number }[] {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => normalizeLineForDigitParsing(l).trim())
    .filter(Boolean);

  const mainsPlays: number[][] = [];
  let cur: number[] = [];
  let started = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (started) {
      if (upper.includes('POWER PLAY') || upper.includes('POWERPLAY') || /\bPB\s*[:#]/i.test(line)) {
        // Stop reading mains once we reach the PB / power play section, but only after we've started
        // (some OCR variants may mention PB earlier in the text, before the actual play lines).
        break;
      }
    }
    if (!looksLikeNumberLineOnly(line)) continue;
    const toks = line.match(/\b\d{1,2}\b/g) ?? [];
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 69);
    if (nums.length === 0) continue;
    // Extra safety: reject date/time streams that still slipped through looksLikeNumberLineOnly.
    if (nums.length === 5) {
      const [a, b, c, d, e] = nums;
      if (a != null && b != null && c != null && d != null && e != null) {
        if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && c >= 0 && c <= 23 && d >= 0 && d <= 59 && e >= 0 && e <= 59) {
          continue;
        }
      }
    }
    if (nums.length >= 6) {
      const hasMonthDay = nums[0]! >= 1 && nums[0]! <= 12 && nums[1]! >= 1 && nums[1]! <= 31;
      let hasTimeTriple = false;
      for (let k = 0; k + 2 < nums.length; k++) {
        const a = nums[k]!;
        const b = nums[k + 1]!;
        const c = nums[k + 2]!;
        if (a >= 0 && a <= 23 && b >= 0 && b <= 59 && c >= 0 && c <= 59) {
          hasTimeTriple = true;
          break;
        }
      }
      if (hasMonthDay && hasTimeTriple) continue;
    }

    // Do not start concatenation until we see a full white-ball line (>=5 tokens),
    // otherwise isolated numeric fragments (e.g. times) can get mixed in.
    if (!started) {
      if (nums.length < 5) continue;
      // Require at least 2 "large" values to avoid starting on date/time streams like "01 06 18 25 59".
      if (nums.filter((n) => n > 31).length < 2) continue;
      started = true;
    }

    cur.push(...nums);
    // When we have at least 5 distinct mains, cut a play.
    const mains: number[] = [];
    const used = new Set<number>();
    for (const n of cur) {
      if (mains.length >= 5) break;
      if (n >= 1 && n <= 69 && !used.has(n)) {
        mains.push(n);
        used.add(n);
      }
    }
    if (isValidDistinctMainSet(mains, 5, 69)) {
      mainsPlays.push(mains.slice().sort((a, b) => a - b));
      cur = [];
    }
  }

  const specials = (specialsHint ?? []).filter((n) => n >= 1 && n <= 26);
  const plays = Math.min(mainsPlays.length, specials.length);
  if (plays <= 0) return [];
  const out: { mains: number[]; special: number }[] = [];
  for (let i = 0; i < plays; i++) {
    out.push({ mains: mainsPlays[i]!, special: specials[i]! });
  }
  return out;
}

function extractWaSplitColumnMegaPlaysFromRawText(
  rawText: string,
): { mains: number[]; special: number }[] {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const upperAll = rawText.toUpperCase();
  const hasMegaBallCol = upperAll.includes('MEGA') && upperAll.includes('BALL');
  if (!hasMegaBallCol) return [];

  // Left zone: A/B/C... lines often contain only the first 3 white balls.
  const leftRows: { idx: number; nums: number[] }[] = [];
  for (const line of lines) {
    const norm = normalizeLineForDigitParsing(line);
    const m = norm.match(/^\s*([A-J])\s*[\.\)]?\s*(.+)$/i);
    if (!m) continue;
    const idx = m[1]!.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    const toks = (m[2] ?? '').match(/\b\d{1,2}\b/g) ?? [];
    const nums = toks.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 70);
    if (nums.length === 3) leftRows.push({ idx, nums });
  }
  if (leftRows.length < 2) return [];
  leftRows.sort((a, b) => a.idx - b.idx);

  // Collect the next singles (4th white ball) that appear as standalone lines.
  const singles: number[] = [];
  const suffixSingles: number[] = [];
  for (const line of lines) {
    const norm = normalizeLineForDigitParsing(line);
    if (/\bMEGA\b/i.test(norm) || /\bBALL\b/i.test(norm)) continue;
    if (/^\s*[A-J]\s*[\.\)]?\s*\d/.test(norm)) continue;
    const m1 = norm.match(/^\s*(\d{1,2})\s*$/);
    if (m1) {
      const n = parseInt(m1[1]!, 10);
      if (n >= 1 && n <= 70) singles.push(n);
      continue;
    }
    const m2 = norm.match(/^\s*(\d{1,2})\s*(0P|OP|QP|AP|GP|CP|aP|oP)\b/i);
    if (m2) {
      const n = parseInt(m2[1]!, 10);
      if (n >= 1 && n <= 70) suffixSingles.push(n);
    }
  }
  const plays = leftRows.length;
  if (singles.length < plays || suffixSingles.length < plays) return [];

  const mbList = extractMegaBallsPerLineFromRawText(rawText);
  const out: { mains: number[]; special: number }[] = [];
  for (let i = 0; i < plays; i++) {
    const left = leftRows[i]!.nums;
    const n4 = singles[i]!;
    const n5 = suffixSingles[i]!;
    const mains = [...left, n4, n5].slice(0, 5);
    const special = mbList[i] ?? 0;
    if (mains.length === 5 && mains.every((n) => n >= 1 && n <= 70) && special >= 0 && special <= 25) {
      out.push({ mains, special });
    }
  }
  return out;
}

/**
 * Final pass: some tickets print specials as labeled lists in raw OCR text
 * (e.g. "PB: 19", "MB: 12") even when spatial parsing mis-attaches a main number.
 *
 * This runs on the final ParsedTicket (after rawText is assembled) and is safe to call multiple times.
 */
export function finalizeUsGameSpecialsFromRawText(
  ticket: FinalizableTicket | null,
  lotteryId: string | undefined,
  specialMin: number,
  specialMax: number,
): FinalizableTicket | null {
  if (!ticket) return null;
  const raw = ticket.rawText?.trim();
  if (!raw) return ticket;

  const id = lotteryId ?? '';

  const applyPbList = (pbList: number[]) => {
    if (!pbList.length) return;
    if (!ticket.specialsPerLine?.length) return;
    if (!(pbList.length === ticket.specialsPerLine.length || pbList.length >= ticket.specialsPerLine.length)) return;
    const plays = ticket.specialsPerLine.length;
    ticket.specialsPerLine = pbList.slice(0, plays);
    const first = ticket.specialsPerLine[0];
    if (first != null && first > 0) ticket.specialNumbers = [first];
  };

  const applyMbList = (mbList: number[]) => {
    if (!mbList.length) return;
    if (!ticket.specialsPerLine?.length) return;
    const plays = ticket.specialsPerLine.length;
    ticket.specialsPerLine = ticket.specialsPerLine.map((cur, i) => {
      if (i >= mbList.length) return cur;
      const v = mbList[i]!;
      return v > 0 ? v : cur;
    });
    const firstNonZero = ticket.specialsPerLine.find((n) => n != null && n > 0);
    if (firstNonZero != null && firstNonZero > 0) ticket.specialNumbers = [firstNonZero];
  };

  const applySingleLabeledSpecial = (sp: number | null) => {
    if (sp == null || sp < specialMin || sp > specialMax) return;
    if (ticket.specialsPerLine?.length && ticket.allSets?.length) {
      ticket.specialsPerLine = ticket.specialsPerLine.map((cur, i) => {
        const set = ticket.allSets?.[i] ?? [];
        if (!cur || cur <= 0) return sp;
        if (set.includes(cur)) return sp;
        return cur;
      });
      const first = ticket.specialsPerLine[0];
      if (first != null && first > 0) ticket.specialNumbers = [first];
      return;
    }
    if (ticket.specialsPerLine?.length && !ticket.allSets?.length) {
      ticket.specialsPerLine = ticket.specialsPerLine.map((cur) => (!cur || cur <= 0 ? sp : cur));
      const first = ticket.specialsPerLine[0];
      if (first != null && first > 0) ticket.specialNumbers = [first];
      return;
    }
    if (ticket.specialNumbers?.length) {
      if (ticket.specialNumbers[0] && ticket.mainNumbers?.includes(ticket.specialNumbers[0])) {
        ticket.specialNumbers = [sp];
      }
      return;
    }
    ticket.specialNumbers = [sp];
  };

  if (id === 'powerball') {
    // Strongest fix: if rawText contains full play lines, trust them over a clearly-wrong spatial parse.
    // This addresses cases where rawText is correct but the on-screen numbers are nonsense.
    const pbListHint = extractPowerballsPerLineFromRawText(raw);

    // NY (and similar) tickets can be OCR'd as split columns: left 3 whites, right 2 whites, specials listed later.
    // Try this before generic recovery to unlock >5 play lines.
    const nyRecovered = extractNySplitColumnPlaysFromRawText(raw);
    if (nyRecovered.length > 0) {
      ticket.allSets = nyRecovered.map((r) => r.mains);
      ticket.mainNumbers = nyRecovered[0]!.mains;
      ticket.specialsPerLine = nyRecovered.map((r) => r.special);
      ticket.specialNumbers = [nyRecovered[0]!.special];
      return ticket;
    }

    // Michigan-style lettered rows + separate PWR list
    const lettered = extractLetteredPowerballPlays(raw);
    const pwrList = extractPwrListFromRawText(raw);
    let appliedRecovered = false;
    if (lettered.length > 0 && (pwrList.length > 0 || lettered.some((p) => p.special != null))) {
      // Align PWR list to lettered rows.
      // OCR sometimes drops a PWR row (common: misses one "26"), which shifts all subsequent values.
      // Use per-row inline special (when present) as an anchor and solve alignment with a small DP:
      // each letter either consumes next PWR value or uses inline (or 0 if unknown).
      const plays = lettered.length;
      const inline = lettered.map((p) => (p.special != null && p.special >= 1 && p.special <= 26 ? p.special : null));
      const INF = 1e9;
      const dp: number[][] = Array.from({ length: plays + 1 }, () => Array(pwrList.length + 1).fill(INF));
      const prev: { takePwr: boolean; prevJ: number }[][] = Array.from({ length: plays + 1 }, () =>
        Array.from({ length: pwrList.length + 1 }, () => ({ takePwr: false, prevJ: 0 })),
      );
      dp[0]![0] = 0;
      for (let i = 0; i < plays; i++) {
        for (let j = 0; j <= pwrList.length; j++) {
          const cur = dp[i]![j]!;
          if (cur >= INF) continue;
          // Option 1: take next PWR value
          if (j < pwrList.length) {
            const want = inline[i];
            const got = pwrList[j]!;
            const mismatch = want != null && want !== got ? 1 : 0;
            if (cur + mismatch < dp[i + 1]![j + 1]!) {
              dp[i + 1]![j + 1] = cur + mismatch;
              prev[i + 1]![j + 1] = { takePwr: true, prevJ: j };
            }
          }
          // Option 2: use inline (or unknown) without consuming PWR
          const hasInline = inline[i] != null;
          const penalty = hasInline ? 0 : 2; // prefer consuming PWR when no inline anchor
          if (cur + penalty < dp[i + 1]![j]!) {
            dp[i + 1]![j] = cur + penalty;
            prev[i + 1]![j] = { takePwr: false, prevJ: j };
          }
        }
      }
      // Pick best end state (prefer consuming more PWR when tied)
      let bestJ = 0;
      let bestCost = INF;
      for (let j = 0; j <= pwrList.length; j++) {
        const c = dp[plays]![j]!;
        if (c < bestCost || (c === bestCost && j > bestJ)) {
          bestCost = c;
          bestJ = j;
        }
      }
      const specials: number[] = Array(plays).fill(0);
      let j = bestJ;
      for (let i = plays; i >= 1; i--) {
        const step = prev[i]![j]!;
        if (step.takePwr) {
          specials[i - 1] = pwrList[step.prevJ]!;
          j = step.prevJ;
        } else {
          specials[i - 1] = inline[i - 1] ?? 0;
          j = step.prevJ;
        }
      }

      // Keep only plays that have a main set; specials may be 0 (unknown) and can be user-edited.
      ticket.allSets = lettered.map((p) => p.mains);
      ticket.mainNumbers = lettered[0]!.mains;
      ticket.specialsPerLine = specials;
      const first = specials[0];
      if (first && first > 0) ticket.specialNumbers = [first];
      appliedRecovered = true;
      // Still allow PB list / single PB overrides below if present.
    }

    // Illinois-style: lettered mains + Powerball values as separate QP/OP lines.
    if (!appliedRecovered && lettered.length > 0) {
      const pbVals = extractPowerballValuesFromQpOpLines(raw);
      if (pbVals.length >= lettered.length) {
        const specials = pbVals.slice(0, lettered.length);
        ticket.allSets = lettered.map((p) => p.mains);
        ticket.mainNumbers = lettered[0]!.mains;
        ticket.specialsPerLine = specials;
        ticket.specialNumbers = [specials[0]!];
        appliedRecovered = true;
      }
    }

    const inline = extractPowerballPlaysFromInlinePbLines(raw);
    const concat = extractPowerballPlaysByConcatenatingNumberLines(raw, pbListHint);
    const recovered = inline.length > 0 ? inline : concat.length > 0 ? concat : extractPowerballPlayLinesFromRawText(raw);

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      const g = globalThis as unknown as { __LP_finalizePbLogged?: boolean };
      if (!g.__LP_finalizePbLogged && /\bPB\s*[:#]/i.test(raw)) {
        g.__LP_finalizePbLogged = true;
        // eslint-disable-next-line no-console
        console.log('[FinalizePB] inline=%d concat=%d simple=%d picked=%d pbList=%d', inline.length, concat.length, extractPowerballPlayLinesFromRawText(raw).length, recovered.length, pbListHint.length);
      }
    }

    // Only override recovered sets when we didn't already recover via lettered plays,
    // unless inline PB lines are present (inline is most reliable).
    const existingPlays = ticket.allSets?.length ?? (ticket.mainNumbers?.length ? 1 : 0);
    const shouldOverrideSets =
      recovered.length > 0 &&
      (inline.length > 0 ||
        (!appliedRecovered &&
          (existingPlays <= 0 ||
            recovered.length >= existingPlays ||
            // If we can recover exactly as many plays as the explicit PB list, trust the recovered mains.
            recovered.length === pbListHint.length)));

    if (shouldOverrideSets) {
      const plays = recovered.length;
      ticket.allSets = recovered.map((r) => r.mains);
      ticket.mainNumbers = recovered[0]!.mains;
      ticket.specialsPerLine = recovered.map((r) => r.special);
      ticket.specialNumbers = [recovered[0]!.special];
    }

    const pbList = pbListHint;
    applyPbList(pbList);
    // Avoid overriding per-line specials recovered from explicit formats (PB: lines, PWR list, Illinois column).
    // Single-value "POWER 25" extraction is only safe when we don't already have per-line mapping.
    if (!appliedRecovered || (ticket.specialsPerLine?.length ?? 0) <= 1) {
      const pb = extractPowerballFromRawText(raw);
      applySingleLabeledSpecial(pb);
    }
    return ticket;
  }

  if (id === 'mega_millions') {
    // NY split columns: left has 4 whites on A–E lines, right has (5th white + MB) pairs.
    const nyMmRecovered = extractNyMegaMillionsSplitColumnPlaysFromRawText(raw);
    if (nyMmRecovered.length > 0) {
      ticket.allSets = nyMmRecovered.map((r) => r.mains);
      ticket.mainNumbers = nyMmRecovered[0]!.mains;
      const baseLen = Math.max(ticket.specialsPerLine?.length ?? 0, nyMmRecovered.length);
      ticket.specialsPerLine = Array.from({ length: baseLen }, (_, i) => nyMmRecovered[i]?.special ?? 0);
      const first = ticket.specialsPerLine.find((n) => n != null && n > 0) ?? 0;
      if (first > 0) ticket.specialNumbers = [first];
      return ticket;
    }

    // WA split columns: lettered 3-ball lines + following single numbers + MEGA BALL column.
    const waRecovered = extractWaSplitColumnMegaPlaysFromRawText(raw);
    if (waRecovered.length > 0) {
      ticket.allSets = waRecovered.map((r) => r.mains);
      ticket.mainNumbers = waRecovered[0]!.mains;
      // Ensure specialsPerLine exists and has at least recovered length (UI may have placeholders).
      const baseLen = Math.max(ticket.specialsPerLine?.length ?? 0, waRecovered.length);
      ticket.specialsPerLine = Array.from({ length: baseLen }, (_, i) => waRecovered[i]?.special ?? 0);
      const first = ticket.specialsPerLine.find((n) => n != null && n > 0) ?? 0;
      if (first > 0) ticket.specialNumbers = [first];
      return ticket;
    }

    const mbListRaw = extractMegaBallsPerLineFromRawText(raw);
    // Some tickets print a 4-line MB list for B–E, while OCR also captured an extra A-line (or vice versa).
    // If mbList is exactly one shorter, align it to start from line 2.
    const plays = ticket.specialsPerLine?.length ?? 0;
    const setCount = ticket.allSets?.length ?? 0;
    let mbList =
      plays > 0 && setCount === plays && mbListRaw.length === plays - 1 ? [0, ...mbListRaw] : mbListRaw;

    // Some jurisdictions print MB inline on some play lines, and the remaining MBs as standalone lines later.
    // Fill missing per-play MBs using ONLY standalone MB-like lines in appearance order (avoid duplicating inline values).
    if (ticket.allSets?.length && ticket.specialsPerLine?.length) {
      const lines = raw
        .replace(/\r/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const lineMbs: number[] = Array(ticket.specialsPerLine.length).fill(0);
      for (const line of lines) {
        const m = line.match(/^\s*([A-Z])\s*[\.\)]?\s*(.+)$/);
        if (!m) continue;
        const idx = m[1]!.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
        if (idx < 0 || idx >= lineMbs.length) continue;
        const parsed = parseUsPbMmLine(line, 5, 70, specialMin, specialMax);
        if (parsed.special != null && parsed.special > 0) lineMbs[idx] = parsed.special;
      }

      const hasAnyInline = lineMbs.some((n) => n > 0);
      const hasMissing = lineMbs.some((n) => !n || n <= 0);
      if (hasAnyInline && hasMissing) {
        const standalone: number[] = [];
        const hasMegaBallHeader = /\bMEGA\s*BALL\b|\bMEGABALL\b|\b[RM]?EGABALL\b/i.test(raw);
        for (const line of lines) {
          // Skip play lines themselves.
          if (/^\s*[A-Z]\s*[\.\)]?\s*\d/.test(line)) continue;
          // "MB: 07" lines (CT / IA etc)
          const mb = line.match(/\bMB\s*[:#\.]?\s*([0-9]{1,2})\b/i);
          if (mb) {
            const n = parseInt(mb[1]!, 10);
            if (Number.isFinite(n) && n >= specialMin && n <= specialMax) {
              standalone.push(n);
              continue;
            }
          }
          // TX-like suffix lines: "04 aP" / "06 QP" etc, only when we saw MEGABALL header.
          if (hasMegaBallHeader) {
            const suf = line.match(/\b([0-9]{1,2})\s*(?:0P|OP|QP|AP|GP|CP|aP|oP)\b/i);
            if (suf) {
              const n = parseInt(suf[1]!, 10);
              if (Number.isFinite(n) && n >= specialMin && n <= specialMax) standalone.push(n);
            }
          }
        }

        if (standalone.length) {
          const filled = lineMbs.slice();
          let p = 0;
          for (let i = 0; i < filled.length && p < standalone.length; i++) {
            if (filled[i] > 0) continue;
            filled[i] = standalone[p++]!;
          }
          mbList = filled;
        }
      }
    }
    applyMbList(mbList);
    const mb = extractMegaBallFromRawText(raw);
    if (!mbList.length && mb != null && mb >= specialMin && mb <= specialMax && ticket.specialsPerLine?.length) {
      // Avoid applySingleLabeledSpecial here: it will happily fill every placeholder UI line with the same Mega Ball.
      const filledIdx = (ticket.allSets ?? [])
        .map((set, i) => ({ i, set }))
        .filter(({ set }) => {
          const mains = (set ?? []).filter((n) => n > 0);
          if (mains.length !== 5) return false;
          return new Set(mains).size === 5;
        })
        .map(({ i }) => i);
      if (filledIdx.length) {
        ticket.specialsPerLine = ticket.specialsPerLine.map((cur, i) => {
          if (!filledIdx.includes(i)) return cur;
          if (cur && cur > 0) return cur;
          return mb;
        });
        const first = ticket.specialsPerLine[0];
        if (first != null && first > 0) ticket.specialNumbers = [first];
      } else {
        applySingleLabeledSpecial(mb);
      }
    } else if (!mbList.length) {
      applySingleLabeledSpecial(mb);
    }
    return ticket;
  }

  return ticket;
}
