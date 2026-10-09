/**
 * Map Compass payload stats to 1–5 star ratings for pick insight UI (reference only).
 */
import type { CompassPayload, ShapeStats } from './types';
import { countsForPositionSlot, tierMapForCountsInRange, type PositionTier } from './positionPickTier';

export function trendStarsFromScore(trendScore: number | undefined): number {
  if (trendScore == null || Number.isNaN(trendScore)) return 1;
  const s = Math.round(trendScore / 20);
  return Math.min(5, Math.max(1, s));
}

export function positionStarsForNumber(
  payload: CompassPayload,
  positionSlotIndex: number,
  n: number,
  mainMin: number,
  mainMax: number
): number {
  const counts = countsForPositionSlot(payload, positionSlotIndex, mainMin, mainMax);
  const maxC = Math.max(1, ...counts);
  const c = counts[n - mainMin] ?? 0;
  const ratio = c / maxC;
  return Math.min(5, Math.max(1, Math.round(ratio * 4 + 1)));
}

/** How many historical “shape” checks the sorted main line passes (odd/even, low/high, sum, gap). */
export function shapeFitHits(tentativeSorted: number[], shape: ShapeStats, mainMax: number): { hits: number; total: number } {
  if (tentativeSorted.length === 0) return { hits: 0, total: 4 };
  const mid = Math.ceil(mainMax / 2);
  let odd = 0;
  let low = 0;
  for (const x of tentativeSorted) {
    if (x % 2 === 1) odd++;
    if (x <= mid) low++;
  }
  const sum = tentativeSorted.reduce((a, b) => a + b, 0);
  let maxGap = 0;
  for (let i = 1; i < tentativeSorted.length; i++) {
    maxGap = Math.max(maxGap, tentativeSorted[i] - tentativeSorted[i - 1]);
  }

  const checks: boolean[] = [
    odd >= shape.oddEven.odd.min && odd <= shape.oddEven.odd.max,
    low >= shape.lowHigh.low.min && low <= shape.lowHigh.low.max,
    sum >= shape.sum.min && sum <= shape.sum.max,
    maxGap >= shape.gaps.min && maxGap <= shape.gaps.max,
  ];
  const hits = checks.filter(Boolean).length;
  return { hits, total: checks.length };
}

export function shapeFitScore100(tentativeSorted: number[], shape: ShapeStats, mainMax: number): number {
  const { hits, total } = shapeFitHits(tentativeSorted, shape, mainMax);
  if (total <= 0) return 0;
  return Math.round((hits / total) * 100);
}

export function shapeStarsFromTentativeMains(tentativeSorted: number[], shape: ShapeStats, mainMax: number): number {
  const { hits, total } = shapeFitHits(tentativeSorted, shape, mainMax);
  if (total <= 0) return 1;
  const ratio = hits / total;
  return Math.min(5, Math.max(1, Math.round(ratio * 5) || 1));
}

export function shapeStarsForMainCandidate(
  payload: CompassPayload,
  currentPicks: number[],
  candidate: number,
  mainMax: number
): number {
  const tentative = [...currentPicks, candidate].sort((a, b) => a - b);
  return shapeStarsFromTentativeMains(tentative, payload.shapeStats, mainMax);
}

export function frequencyStars(count: number, maxCount: number): number {
  const maxC = Math.max(1, maxCount);
  const ratio = count / maxC;
  return Math.min(5, Math.max(1, Math.round(ratio * 4 + 1)));
}

export function specialBallFrequencyStars(payload: CompassPayload, specialN: number, specialMin: number, specialMax: number): number {
  const sf = payload.specialFrequency;
  if (!sf || sf.min !== specialMin || sf.max !== specialMax || sf.counts.length !== specialMax - specialMin + 1) {
    return 3;
  }
  const idx = specialN - specialMin;
  const c = sf.counts[idx] ?? 0;
  const maxC = Math.max(1, ...sf.counts);
  return frequencyStars(c, maxC);
}

/** Special “position” row: map frequency tier to stars (no sorted main slot). */
export function specialTierStars(tier: 'top' | 'mid' | 'bot'): number {
  if (tier === 'top') return 5;
  if (tier === 'mid') return 3;
  return 2;
}

/** Shape row when choosing special ball: same historical “main line” fit as completed mains (reference). */
export function shapeStarsForSpecialWithMains(mainPicksSorted: number[], shape: ShapeStats, mainMax: number): number {
  if (mainPicksSorted.length === 0) return 1;
  return shapeStarsFromTentativeMains(mainPicksSorted, shape, mainMax);
}

export function positionScore100(
  payload: CompassPayload,
  positionSlotIndex: number,
  n: number,
  mainMin: number,
  mainMax: number
): number {
  const counts = countsForPositionSlot(payload, positionSlotIndex, mainMin, mainMax);
  const maxC = Math.max(1, ...counts);
  const c = counts[n - mainMin] ?? 0;
  return Math.round((c / maxC) * 100);
}

function tierToScore100(tier: PositionTier): number {
  if (tier === 'top') return 100;
  if (tier === 'mid') return 55;
  return 30;
}

export type EvaluatePickMainRow = {
  positionSlot: number;
  n: number;
  trendStars: number;
  positionStars: number;
  trend100: number;
  position100: number;
};

export type EvaluatePickBreakdown = {
  total100: number;
  mainRows: EvaluatePickMainRow[];
  shape100: number;
  shapeStars: number;
  special?: {
    n: number;
    label: string;
    trendStars: number;
    positionStars: number;
    trend100: number;
    position100: number;
  };
};

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Full-line evaluate summary: per-main trend/position (stars + 0–100), optional special, overall shape, composite /100.
 */
export function computeEvaluatePickBreakdown(
  picks: number[],
  specialPick: number | null,
  payload: CompassPayload,
  mainMin: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
  includeSpecial: boolean,
  specialBallLabel: string
): EvaluatePickBreakdown {
  const tsMap = new Map(payload.trendScores.map((t) => [t.number, t]));
  const sorted = [...picks].sort((a, b) => a - b);

  const mainRows: EvaluatePickMainRow[] = picks.map((n, positionSlot) => {
    const t = tsMap.get(n);
    const trend100 = t != null ? Math.round(Math.min(100, Math.max(0, t.trendScore))) : 0;
    const trendStars = trendStarsFromScore(t?.trendScore);
    const positionStars = positionStarsForNumber(payload, positionSlot, n, mainMin, mainMax);
    const position100 = positionScore100(payload, positionSlot, n, mainMin, mainMax);
    return { positionSlot, n, trendStars, positionStars, trend100, position100 };
  });

  const shape100 = shapeFitScore100(sorted, payload.shapeStats, mainMax);
  const shapeStars = shapeStarsFromTentativeMains(sorted, payload.shapeStats, mainMax);

  let specialRow: EvaluatePickBreakdown['special'];
  if (includeSpecial && specialPick != null && specialMax >= specialMin) {
    const sf = payload.specialFrequency;
    const span = Math.max(0, specialMax - specialMin + 1);
    const countsForTier =
      sf && sf.min === specialMin && sf.max === specialMax && sf.counts.length === span
        ? sf.counts
        : new Array(span).fill(0);

    let trend100 = 50;
    let trendStars = 3;
    if (sf && sf.min === specialMin && sf.max === specialMax && sf.counts.length === span) {
      const idx = specialPick - specialMin;
      const c = sf.counts[idx] ?? 0;
      const maxC = Math.max(1, ...sf.counts);
      trend100 = Math.round((c / maxC) * 100);
      trendStars = frequencyStars(c, maxC);
    }

    const tierMap = tierMapForCountsInRange(countsForTier, specialMin, specialMax);
    const tier = tierMap.get(specialPick) ?? 'mid';
    const positionStars = specialTierStars(tier);
    const position100 = tierToScore100(tier);

    specialRow = {
      n: specialPick,
      label: specialBallLabel,
      trendStars,
      positionStars,
      trend100,
      position100,
    };
  }

  const trendVals = mainRows.map((r) => r.trend100);
  const posVals = mainRows.map((r) => r.position100);
  if (specialRow) {
    trendVals.push(specialRow.trend100);
    posVals.push(specialRow.position100);
  }

  const total100 = Math.round((mean(trendVals) + mean(posVals) + shape100) / 3);

  return {
    total100: Math.min(100, Math.max(0, total100)),
    mainRows,
    shape100,
    shapeStars,
    special: specialRow,
  };
}
