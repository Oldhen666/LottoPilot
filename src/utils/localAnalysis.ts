/**
 * Local number analysis - runs fully on device.
 * For entertainment and decision support only. Does not guarantee any outcome.
 */

import { LOTTERY_DEFS } from '../constants/lotteries';
import type { LotteryId } from '../types/lottery';
import type { GenerateParams } from '../types/generateParams';
import type { CompassPayload } from '../compass/types';

export interface AnalysisWeights {
  hotWeight: number;    // 0-1, prefer frequent numbers
  coldWeight: number;   // 0-1, prefer rare numbers
  oddEvenRatio: number; // 0-1, 0=more even, 0.5=balanced, 1=more odd
  consecutivePenalty: number; // 0-1, avoid consecutive
}

export interface CandidatePick {
  main: number[];
  special: number[];
  explanation: string;
}

function defaultWeights(): AnalysisWeights {
  return {
    hotWeight: 0.4,
    coldWeight: 0.3,
    oddEvenRatio: 0.5,
    consecutivePenalty: 0.5,
  };
}

/**
 * Generate K candidate picks based on history and weights.
 * Uses simple frequency + heuristics. No server call.
 */
export function generateCandidates(
  lotteryId: LotteryId,
  history: { winning_numbers: number[]; special_numbers?: number[] }[],
  weights: Partial<AnalysisWeights> = {},
  count = 5
): CandidatePick[] {
  const w = { ...defaultWeights(), ...weights };
  const def = LOTTERY_DEFS[lotteryId];
  if (!def) return [];

  const mainFreq: Record<number, number> = {};
  const specialFreq: Record<number, number> = {};
  for (let i = def.main_min; i <= def.main_max; i++) {
    mainFreq[i] = 0;
  }
  for (const d of history) {
    for (const n of d.winning_numbers) mainFreq[n] = (mainFreq[n] || 0) + 1;
    for (const n of d.special_numbers || []) {
      specialFreq[n] = (specialFreq[n] || 0) + 1;
    }
  }

  const mainSorted = Object.entries(mainFreq)
    .map(([n, c]) => ({ n: parseInt(n, 10), c }))
    .sort((a, b) => b.c - a.c);
  const hot = mainSorted.slice(0, 15).map((x) => x.n);
  const cold = mainSorted.slice(-15).map((x) => x.n);

  const picks: CandidatePick[] = [];
  const used = new Set<string>();

  for (let i = 0; i < count; i++) {
    const main: number[] = [];
    const pool = [...Array(def.main_max - def.main_min + 1)].map((_, j) => def.main_min + j);
    const pickFromHot = Math.floor(def.main_count * w.hotWeight);
    const pickFromCold = Math.floor(def.main_count * w.coldWeight);
    const pickBalanced = def.main_count - pickFromHot - pickFromCold;

    const chosen = new Set<number>();
    for (let j = 0; j < pickFromHot && hot.length; j++) {
      const n = hot[Math.floor(Math.random() * hot.length)];
      if (!chosen.has(n)) {
        chosen.add(n);
        main.push(n);
      }
    }
    for (let j = 0; j < pickFromCold && cold.length; j++) {
      const n = cold[Math.floor(Math.random() * cold.length)];
      if (!chosen.has(n)) {
        chosen.add(n);
        main.push(n);
      }
    }
    while (main.length < def.main_count) {
      const n = pool[Math.floor(Math.random() * pool.length)];
      if (!chosen.has(n)) {
        chosen.add(n);
        main.push(n);
      }
    }
    main.sort((a, b) => a - b);

    const specialMax = def.special_max || 49;
    const special = [Math.floor(Math.random() * specialMax) + 1];

    const key = main.join(',') + '|' + special.join(',');
    if (used.has(key)) {
      i--;
      continue;
    }
    used.add(key);

    const oddCount = main.filter((x) => x % 2 === 1).length;
    picks.push({
      main,
      special,
      explanation: `Hot/cold weighted mix. Odd count: ${oddCount}/${def.main_count}. For analysis only.`,
    });
  }

  return picks;
}

/**
 * Generate remaining numbers to fill empty slots, keeping existing picks.
 * Uses Compass params (trend, position, shape) when payload provided. Fallback to hot/cold.
 */
export function generateRemainingNumbers(
  lotteryId: LotteryId,
  history: { winning_numbers: number[] }[],
  existingPicks: number[],
  params?: GenerateParams,
  payload?: CompassPayload | null,
  lockFirstNumber?: boolean
): number[] | null {
  const def = LOTTERY_DEFS[lotteryId];
  if (!def || history.length < 2) return null;

  const used = new Set(existingPicks.filter((x) => x > 0));
  const needed = def.main_count - used.size;
  if (needed <= 0) return [];

  const p = params ?? {
    trendScore: 50,
    positionFreq: 50,
    oddEven: 50,
    lowHighSplit: 50,
    sumRange: 50,
    maxGap: 50,
  };

  const minExisting = existingPicks.length > 0 ? Math.min(...existingPicks) : null;
  let pool = [...Array(def.main_max - def.main_min + 1)].map((_, j) => def.main_min + j);
  if (lockFirstNumber && minExisting != null) {
    pool = pool.filter((n) => n >= minExisting);
  }
  const candidates = pool.filter((n) => !used.has(n));

  if (payload && candidates.length > 0) {
    return generateWithCompassParams(def, payload, existingPicks, needed, p, lockFirstNumber ? minExisting ?? undefined : undefined);
  }

  return generateWithHotCold(history, def, used, needed, lockFirstNumber ? minExisting ?? undefined : undefined);
}

function generateWithHotCold(
  history: { winning_numbers: number[] }[],
  def: { main_min: number; main_max: number; main_count: number },
  used: Set<number>,
  needed: number,
  minLock?: number
): number[] {
  const mainFreq: Record<number, number> = {};
  for (let i = def.main_min; i <= def.main_max; i++) mainFreq[i] = 0;
  for (const d of history) {
    for (const n of d.winning_numbers) mainFreq[n] = (mainFreq[n] || 0) + 1;
  }
  const mainSorted = Object.entries(mainFreq)
    .map(([n, c]) => ({ n: parseInt(n, 10), c }))
    .sort((a, b) => b.c - a.c);
  const hot = mainSorted.slice(0, 15).map((x) => x.n);
  const cold = mainSorted.slice(-15).map((x) => x.n);
  const w = defaultWeights();
  const pickFromHot = Math.floor(needed * w.hotWeight);
  const pickFromCold = Math.floor(needed * w.coldWeight);
  let pool = [...Array(def.main_max - def.main_min + 1)].map((_, j) => def.main_min + j);
  if (minLock != null) pool = pool.filter((n) => n >= minLock);
  const result: number[] = [];
  const chosen = new Set(used);
  for (let j = 0; j < pickFromHot && hot.length; j++) {
    const n = hot[Math.floor(Math.random() * hot.length)];
    if (!chosen.has(n)) {
      chosen.add(n);
      result.push(n);
    }
  }
  for (let j = 0; j < pickFromCold && cold.length; j++) {
    const n = cold[Math.floor(Math.random() * cold.length)];
    if (!chosen.has(n)) {
      chosen.add(n);
      result.push(n);
    }
  }
  while (result.length < needed) {
    const n = pool[Math.floor(Math.random() * pool.length)];
    if (!chosen.has(n)) {
      chosen.add(n);
      result.push(n);
    }
  }
  return result.sort((a, b) => a - b);
}

function generateWithCompassParams(
  def: { main_min: number; main_max: number; main_count: number },
  payload: CompassPayload,
  existingPicks: number[],
  needed: number,
  p: GenerateParams,
  minLock?: number
): number[] {
  const mid = Math.floor((def.main_max - def.main_min + 1) / 2) + def.main_min;
  const used = new Set(existingPicks.filter((x) => x > 0));
  const result: number[] = [];
  const chosen = new Set(used);
  const poolFilter = (n: number) => (minLock == null || n >= minLock) && !chosen.has(n);

  const trendMap = new Map(payload.trendScores.map((t) => [t.number, t.trendScore]));
  const posData = payload.positionTopK;
  const shape = payload.shapeStats;

  const targetOddRatio = p.oddEven / 100;
  const targetLowRatio = 1 - p.lowHighSplit / 100;
  const sumMid = (shape.sum.min + shape.sum.max) / 2;
  const sumSpread = shape.sum.max - shape.sum.min;
  const targetSum = sumMid + (p.sumRange - 50) / 50 * (sumSpread / 2);
  const gapMid = (shape.gaps.min + shape.gaps.max) / 2;
  const targetGap = gapMid + (p.maxGap - 50) / 50 * 5;

  for (let slotIdx = 0; slotIdx < needed; slotIdx++) {
    const position = existingPicks.filter((x) => x > 0).length + slotIdx + 1;
    const posTopK = posData.find((d) => d.position === position);
    const posRank = new Map<number, number>();
    if (posTopK?.topKList) {
      posTopK.topKList.forEach(({ number }, idx) => posRank.set(number, 10 - idx));
    }

    const pool = [...Array(def.main_max - def.main_min + 1)]
      .map((_, j) => def.main_min + j)
      .filter(poolFilter);

    const scores = pool.map((n) => {
      let s = 0.5;
      if (p.trendScore !== 50 && trendMap.has(n)) {
        const t = (trendMap.get(n)! - 50) / 50;
        s += ((p.trendScore - 50) / 50) * t * 0.3;
      }
      if (p.positionFreq > 0 && posRank.has(n)) {
        s += (p.positionFreq / 100) * (posRank.get(n)! / 10) * 0.3;
      }
      const currentOdd = [...chosen, n].filter((x) => x % 2 === 1).length;
      const currentTotal = [...chosen, n].reduce((a, b) => a + b, 0);
      const oddBonus = Math.abs(currentOdd / (chosen.size + 1) - targetOddRatio) < 0.3 ? 0.2 : 0;
      const sumBonus = Math.abs(currentTotal - targetSum * (chosen.size + 1) / def.main_count) < sumSpread ? 0.1 : 0;
      const isLow = n < mid;
      const lowBonus = (targetLowRatio > 0.5 && isLow) || (targetLowRatio < 0.5 && !isLow) ? 0.1 : 0;
      return Math.max(0.01, s + oddBonus + sumBonus + lowBonus);
    });

    const total = scores.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let pick = pool[0];
    for (let i = 0; i < pool.length; i++) {
      r -= scores[i];
      if (r <= 0) {
        pick = pool[i];
        break;
      }
    }
    chosen.add(pick);
    result.push(pick);
  }
  return result.sort((a, b) => a - b);
}
