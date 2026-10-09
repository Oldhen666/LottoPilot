/**
 * Tier balls by historical frequency at a sorted ascending slot (Position tab semantics).
 * Top 30% count rank → high; middle 40% → mid; bottom 30% → low.
 */
import type { CompassPayload } from './types';

export type PositionTier = 'top' | 'mid' | 'bot';

/** Sorted ascending slot index 0..mainCount-1 → CSV position column 1..mainCount */
export function csvPositionFromSlot(slotIndex: number): number {
  return slotIndex + 1;
}

export function validRangeForSlot(
  slotIndex: number,
  picksSoFar: number[],
  mainCount: number,
  mainMin: number,
  mainMax: number
): { lo: number; hi: number } {
  const lo = slotIndex === 0 ? mainMin : picksSoFar[slotIndex - 1] + 1;
  const remainingAfter = mainCount - 1 - slotIndex;
  const hi = mainMax - remainingAfter;
  return { lo, hi };
}

/** counts[index] = frequency for number (mainMin + index); length = mainMax - mainMin + 1 */
export function countsForPositionSlot(
  payload: CompassPayload,
  slotIndex: number,
  mainMin: number,
  mainMax: number
): number[] {
  const span = mainMax - mainMin + 1;
  const position = csvPositionFromSlot(slotIndex);
  const row = payload.positionFrequencies?.find((r) => r.position === position);
  if (row && row.counts.length === span) {
    return row.counts;
  }
  const pt = payload.positionTopK.find((p) => p.position === position);
  const out = new Array(span).fill(0);
  if (pt) {
    for (const { number: n, count } of pt.topKList) {
      const idx = n - mainMin;
      if (idx >= 0 && idx < span) out[idx] = count;
    }
  }
  return out;
}

export function tierMapForPositionCounts(
  counts: number[],
  mainMin: number,
  mainMax: number
): Map<number, PositionTier> {
  const pairs: { n: number; c: number }[] = [];
  for (let n = mainMin; n <= mainMax; n++) {
    pairs.push({ n, c: counts[n - mainMin] ?? 0 });
  }
  pairs.sort((a, b) => b.c - a.c || a.n - b.n);
  const len = pairs.length;
  const topEnd = Math.max(1, Math.ceil(len * 0.3));
  const midEnd = Math.max(topEnd, Math.ceil(len * 0.7));
  const map = new Map<number, PositionTier>();
  pairs.forEach((p, idx) => {
    map.set(p.n, idx < topEnd ? 'top' : idx < midEnd ? 'mid' : 'bot');
  });
  return map;
}

export function tierMapForCountsInRange(counts: number[], min: number, max: number): Map<number, PositionTier> {
  const pairs: { n: number; c: number }[] = [];
  for (let n = min; n <= max; n++) {
    pairs.push({ n, c: counts[n - min] ?? 0 });
  }
  pairs.sort((a, b) => b.c - a.c || a.n - b.n);
  const len = pairs.length;
  const topEnd = Math.max(1, Math.ceil(len * 0.3));
  const midEnd = Math.max(topEnd, Math.ceil(len * 0.7));
  const map = new Map<number, PositionTier>();
  pairs.forEach((p, idx) => {
    map.set(p.n, idx < topEnd ? 'top' : idx < midEnd ? 'mid' : 'bot');
  });
  return map;
}
