/**
 * Local number analysis - runs fully on device.
 * For entertainment and decision support only. Does not guarantee any outcome.
 */

import { LOTTERY_DEFS } from '../constants/lotteries';
import type { LotteryId } from '../types/lottery';

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
