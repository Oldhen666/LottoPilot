/**
 * Display scores for "Trend (all main numbers)" reference list.
 * Uses rank within the full main-number pool so the UI spans ~6–97 (single digits
 * through 90s) even when raw 0–100 scores cluster.
 */
import type { NumberTrendScore } from './types';

const DISPLAY_MIN = 6;
const DISPLAY_MAX = 97;

/** rankDescending: 0 = highest trend in pool */
export function trendDisplayFromPoolRank(rankDescending: number, poolSize: number): number {
  if (poolSize <= 0) return 52;
  if (poolSize === 1) return 52;
  const span = DISPLAY_MAX - DISPLAY_MIN;
  const t = (poolSize - 1 - rankDescending) / (poolSize - 1);
  return Math.round(DISPLAY_MIN + t * span);
}

/** Map ball number → display score (6..97), monotonic with trend strength. */
export function buildTrendReferenceDisplayByNumber(rows: NumberTrendScore[]): Map<number, number> {
  const sorted = [...rows].sort(
    (a, b) => b.trendScore - a.trendScore || a.number - b.number
  );
  const n = sorted.length;
  const map = new Map<number, number>();
  sorted.forEach((row, idx) => {
    map.set(row.number, trendDisplayFromPoolRank(idx, n));
  });
  return map;
}
