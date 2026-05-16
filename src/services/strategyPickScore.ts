/**
 * Strategy Lab pick scoring: aligns with engine params + recent draws — independent from Compass Pick Evaluation.
 * Display score is always in [61, 100] per product spec.
 */
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { FeatureId } from '../constants/strategyFeatures';
import type { LotteryId } from '../types/lottery';
import { STRATEGY_PLAY_STYLE_SHORT } from '../constants/strategyPlayStyle';
import type { StrategySet } from '../types/strategy';
import type { CandidatePick } from '../utils/localAnalysis';
import { featureWeightsToParams } from './strategyEngine';

export type { StrategyPlayStyleId } from '../constants/strategyPlayStyle';
export { STRATEGY_PLAY_STYLE_IDS, STRATEGY_PLAY_STYLE_LABEL, STRATEGY_PLAY_STYLE_SHORT } from '../constants/strategyPlayStyle';

const DISPLAY_MIN = 61;
const DISPLAY_MAX = 100;
/** Kept small so expand/collapse does not block the UI thread on re-renders. */
const RANDOM_SAMPLES = 24;

export type StrategyScoreTier = { emoji: string; title: string };

export type StrategyScoreFactor = { kind: 'positive' | 'risk'; text: string };

export function scoreTierFromDisplay(s: number): StrategyScoreTier {
  if (s >= 90) return { emoji: '🔥', title: 'Elite Pick' };
  if (s >= 80) return { emoji: '🔥', title: 'Strong Pick' };
  if (s >= 70) return { emoji: '✅', title: 'Good Pick' };
  if (s >= 60) return { emoji: '⚖️', title: 'Balanced Pick' };
  return { emoji: '⚠️', title: 'Experimental Pick' };
}

function derivePlayStyle(
  displayScore: number,
  params: ReturnType<typeof featureWeightsToParams>,
  hotHits: number,
  mainCount: number,
  sumOk: boolean,
  oddOk: boolean
): string {
  const hotR = hotHits / Math.max(1, mainCount);
  if (params.hotWeight >= 0.48 && hotR >= 0.28) return STRATEGY_PLAY_STYLE_SHORT.trend;
  if (!sumOk && displayScore >= 78) return STRATEGY_PLAY_STYLE_SHORT.aggressive;
  if (!oddOk && displayScore >= 80) return STRATEGY_PLAY_STYLE_SHORT.aggressive;
  if (params.hotWeight <= 0.38 && sumOk && oddOk) return STRATEGY_PLAY_STYLE_SHORT.safe;
  if (sumOk && oddOk && displayScore >= 72) return STRATEGY_PLAY_STYLE_SHORT.balanced;
  return STRATEGY_PLAY_STYLE_SHORT.balanced;
}

/** Up to 3 short, plain-English lines for the score card. */
export function buildStrategyScoreFactors(
  lotteryId: LotteryId,
  history: { winning_numbers: number[] }[],
  weights: Record<FeatureId, number>,
  mainSorted: number[]
): StrategyScoreFactor[] {
  const def = LOTTERY_DEFS[lotteryId];
  const pools = hotColdPools(lotteryId, history);
  const params = featureWeightsToParams(weights);
  if (!def || !pools) {
    return [{ kind: 'positive', text: 'Matches the mix of your current strategy settings' }];
  }

  const mainCount = mainSorted.length;
  let hotHits = 0;
  for (const n of mainSorted) {
    if (pools.hot.has(n)) hotHits += 1;
  }

  const targetOdd = Math.round(mainCount * params.oddEvenRatio);
  const actualOdd = mainSorted.filter((x) => x % 2 === 1).length;
  const oddOk = Math.abs(targetOdd - actualOdd) <= 1;

  const { lo, hi } = historicalSumBand(history, mainCount);
  const s = mainSorted.reduce((a, b) => a + b, 0);
  const sumOk = s >= lo && s <= hi;
  const band = hi > lo ? hi - lo : 1;

  const out: StrategyScoreFactor[] = [];

  if (hotHits >= 2) {
    out.push({ kind: 'positive', text: `Includes ${hotHits} hot numbers` });
  } else if (hotHits === 1) {
    out.push({ kind: 'positive', text: 'Includes a hot number' });
  } else if (params.hotWeight > 0.42) {
    out.push({ kind: 'risk', text: 'Light on numbers that have been hot lately' });
  }

  if (oddOk) {
    out.push({ kind: 'positive', text: 'Balanced odd/even structure' });
  } else {
    out.push({ kind: 'risk', text: 'Odd/even mix strays from your setting' });
  }

  if (sumOk) {
    out.push({ kind: 'positive', text: 'Total sum looks familiar for recent draws' });
  } else if (s > hi) {
    out.push({
      kind: 'risk',
      text: s > hi + band * 0.12 ? 'Higher total sum than usual' : 'Slightly higher total sum',
    });
  } else {
    out.push({ kind: 'risk', text: 'Lower total sum than usual' });
  }

  return out.slice(0, 3);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function hotColdPools(
  lotteryId: LotteryId,
  history: { winning_numbers: number[] }[]
): { hot: Set<number>; cold: Set<number>; mainMin: number; mainMax: number } | null {
  const def = LOTTERY_DEFS[lotteryId];
  if (!def || history.length < 2) return null;
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
  return { hot: new Set(hot), cold: new Set(cold), mainMin: def.main_min, mainMax: def.main_max };
}

function historicalSumBand(history: { winning_numbers: number[] }[], mainCount: number): { lo: number; hi: number } {
  const sums: number[] = [];
  for (const d of history) {
    const m = d.winning_numbers.slice(0, mainCount).sort((a, b) => a - b);
    if (m.length >= mainCount) sums.push(m.reduce((a, b) => a + b, 0));
  }
  if (sums.length === 0) return { lo: 0, hi: 99999 };
  const sorted = [...sums].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(Math.max(0, Math.min(sorted.length - 1, p * (sorted.length - 1))))];
  return { lo: q(0.15), hi: q(0.85) };
}

/** Raw alignment quality in ~[0,1], higher = better match to strategy + recent patterns. */
export function lineAlignmentQuality01(
  lotteryId: LotteryId,
  history: { winning_numbers: number[] }[],
  weights: Record<FeatureId, number>,
  mainSorted: number[]
): number {
  const def = LOTTERY_DEFS[lotteryId];
  const pools = hotColdPools(lotteryId, history);
  const params = featureWeightsToParams(weights);
  if (!def || !pools || mainSorted.length !== def.main_count) return 0.35;

  const mainCount = def.main_count;
  const mid = Math.ceil((def.main_min + def.main_max) / 2);
  const pickFromHot = Math.floor(mainCount * params.hotWeight);
  const pickFromCold = Math.floor(mainCount * params.coldWeight);

  let hotHits = 0;
  let coldHits = 0;
  for (const n of mainSorted) {
    if (pools.hot.has(n)) hotHits += 1;
    if (pools.cold.has(n)) coldHits += 1;
  }

  const targetHotShare = pickFromHot / Math.max(1, mainCount);
  const targetColdShare = pickFromCold / Math.max(1, mainCount);
  const hotShare = hotHits / mainCount;
  const coldShare = coldHits / mainCount;
  const trendFit =
    1 -
    (Math.abs(hotShare - targetHotShare) * params.hotWeight + Math.abs(coldShare - targetColdShare) * params.coldWeight) /
      Math.max(0.2, params.hotWeight + params.coldWeight);

  const targetOdd = Math.round(mainCount * params.oddEvenRatio);
  const actualOdd = mainSorted.filter((x) => x % 2 === 1).length;
  const oddFit = 1 - Math.abs(targetOdd - actualOdd) / mainCount;

  const targetLow = Math.round(mainCount * (1 - params.lowHighRatio));
  const actualLow = mainSorted.filter((n) => n <= mid).length;
  const lowHighFit = 1 - Math.abs(targetLow - actualLow) / mainCount;

  const { lo: sumLo, hi: sumHi } = historicalSumBand(history, mainCount);
  const s = mainSorted.reduce((a, b) => a + b, 0);
  let sumFit = 1;
  if (sumHi > sumLo) {
    if (s < sumLo) sumFit = clamp01(1 - (sumLo - s) / (sumHi - sumLo + 1));
    else if (s > sumHi) sumFit = clamp01(1 - (s - sumHi) / (sumHi - sumLo + 1));
    else sumFit = 1;
  }

  const sorted = [...mainSorted];
  let maxGap = 0;
  let gapSum = 0;
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i] - sorted[i - 1];
    gapSum += g;
    maxGap = Math.max(maxGap, g);
  }
  const avgGap = sorted.length > 1 ? gapSum / (sorted.length - 1) : 0;
  const range = def.main_max - def.main_min;
  const maxGapNorm = range > 0 ? maxGap / range : 0;
  const avgGapNorm = range > 0 ? avgGap / range : 0;
  const gapTarget = params.gapWeight;
  const clusterTarget = params.clustering;
  const gapFit = 1 - Math.abs(maxGapNorm - gapTarget * 0.5) * 0.8;
  const spread = avgGapNorm;
  const clusterFit = 1 - Math.abs(spread - (0.15 + clusterTarget * 0.35)) * 1.2;

  let consec = 0;
  let birthday = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] === 1) consec += 1;
  }
  for (const n of sorted) {
    if (n >= 1 && n <= 31) birthday += 1;
  }
  const riskDed =
    (consec / Math.max(1, mainCount - 1)) * params.consecutivePenalty * 0.35 +
    (birthday / mainCount) * params.birthdayPenalty * 0.25;

  const q =
    0.26 * clamp01(trendFit) +
    0.2 * clamp01(oddFit) +
    0.18 * clamp01(lowHighFit) +
    0.18 * clamp01(sumFit) +
    0.09 * clamp01(gapFit) +
    0.09 * clamp01(clusterFit) -
    riskDed;

  return clamp01(q);
}

function displayScoreFromQuality(q: number): number {
  const qq = clamp01(q);
  return Math.min(DISPLAY_MAX, Math.max(DISPLAY_MIN, DISPLAY_MIN + Math.round((DISPLAY_MAX - DISPLAY_MIN) * qq)));
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG for percentile sampling (stable result per pick + strategy). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomSortedMainLineRng(rng: () => number, mainMin: number, mainMax: number, mainCount: number): number[] {
  const pool: number[] = [];
  for (let n = mainMin; n <= mainMax; n++) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, mainCount).sort((a, b) => a - b);
}

export function computeStrategyScoreSummary(
  lotteryId: LotteryId,
  history: { winning_numbers: number[]; special_numbers?: number[] }[],
  set: StrategySet,
  picks: CandidatePick[]
): {
  bestScoreDisplay: number;
  percentileRough: number;
  tier: StrategyScoreTier;
  factors: StrategyScoreFactor[];
  playStyle: string;
  perPickDisplayScores: number[];
} {
  if (!history || history.length < 2 || picks.length === 0) {
    const fb = displayScoreFromQuality(0.45);
    return {
      bestScoreDisplay: fb,
      percentileRough: 50,
      tier: scoreTierFromDisplay(fb),
      factors: [{ kind: 'positive', text: 'Add a bit more draw history for a fuller readout' }],
      playStyle: STRATEGY_PLAY_STYLE_SHORT.balanced,
      perPickDisplayScores: picks.map(() => fb),
    };
  }

  const hist = history.map((d) => ({ winning_numbers: d.winning_numbers }));
  const weights = set.featureWeights as Record<FeatureId, number>;
  const params = featureWeightsToParams(weights);
  const qualities: number[] = picks.map((p) => lineAlignmentQuality01(lotteryId, hist, weights, [...p.main].sort((a, b) => a - b)));
  const bestQ = Math.max(...qualities);
  const bestIdx = qualities.indexOf(bestQ);
  const bestMain = [...picks[bestIdx].main].sort((a, b) => a - b);

  const def = LOTTERY_DEFS[lotteryId];
  let percentileRough = 55;
  if (def) {
    const seed =
      hashSeed(`${lotteryId}|${set.id}|${bestMain.join(',')}|${hist.length}`) ^ (Math.round(bestQ * 1e6) >>> 0);
    const rng = makeRng(seed);
    let below = 0;
    for (let i = 0; i < RANDOM_SAMPLES; i++) {
      const rnd = randomSortedMainLineRng(rng, def.main_min, def.main_max, def.main_count);
      const rq = lineAlignmentQuality01(lotteryId, hist, weights, rnd);
      if (rq < bestQ) below += 1;
    }
    percentileRough = Math.round((below / RANDOM_SAMPLES) * 100);
  }

  const factors = buildStrategyScoreFactors(lotteryId, hist, weights, bestMain);
  const bestScoreDisplay = displayScoreFromQuality(bestQ);
  const pools = hotColdPools(lotteryId, hist);
  let hotHits = 0;
  if (pools) {
    for (const n of bestMain) {
      if (pools.hot.has(n)) hotHits += 1;
    }
  }
  const mainCount = bestMain.length;
  const targetOdd = Math.round(mainCount * params.oddEvenRatio);
  const actualOdd = bestMain.filter((x) => x % 2 === 1).length;
  const oddOk = Math.abs(targetOdd - actualOdd) <= 1;
  const { lo, hi } = historicalSumBand(hist, mainCount);
  const s = bestMain.reduce((a, b) => a + b, 0);
  const sumOk = s >= lo && s <= hi;

  const tier = scoreTierFromDisplay(bestScoreDisplay);
  const playStyle =
    tier.title === 'Experimental Pick'
      ? STRATEGY_PLAY_STYLE_SHORT.experimental
      : derivePlayStyle(bestScoreDisplay, params, hotHits, mainCount, sumOk, oddOk);

  const perPickDisplayScores = qualities.map((q) => displayScoreFromQuality(q));

  return {
    bestScoreDisplay,
    percentileRough,
    tier,
    factors,
    playStyle,
    perPickDisplayScores,
  };
}
