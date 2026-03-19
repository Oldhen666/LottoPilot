/**
 * Feature-driven strategy engine: generates numbers from Strategy Set weights.
 * Fully local, deterministic. AI does NOT participate in generation.
 * Lucky bias: personal preference layer, max influence ≤5%, only in balanced-pool selection.
 */
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { LotteryId } from '../types/lottery';
import type { StrategySet, LuckyBiasStrength } from '../types/strategy';
import type { FeatureId } from '../constants/strategyFeatures';
import type { CandidatePick } from '../utils/localAnalysis';

const LUCKY_BIAS_MULTIPLIER: Record<Exclude<LuckyBiasStrength, 'off'>, number> = {
  low: 0.017,    // ~1.7% max influence
  medium: 0.033, // ~3.3%
  high: 0.05,    // 5% max
};

interface PickParams {
  risk: { consecutivePenalty: number; birthdayPenalty: number; symmetryPenalty: number };
  structure: { oddEvenRatio: number; lowHighRatio: number; sumRangeWeight: number; gapWeight: number; clustering: number };
  position: { edgeBias: number; midDensity: number; positionFreq: number };
  mainMin: number;
  mainMax: number;
  mainCount: number;
}

/** Weighted random: structure + position + risk + lucky bias. */
function pickWithAllBiases(
  candidates: number[],
  chosen: Set<number>,
  chosenArr: number[],
  lucky: number[],
  luckyBoost: number,
  p: PickParams
): number {
  const luckySet = new Set(lucky);
  const symmetricPartner = (n: number) => p.mainMin + p.mainMax + 1 - n;
  const mid = Math.ceil((p.mainMin + p.mainMax) / 2);
  const range = p.mainMax - p.mainMin;
  const currentOdd = chosenArr.filter((x) => x % 2 === 1).length;
  const targetOdd = Math.round(p.mainCount * p.structure.oddEvenRatio);
  const needOdd = targetOdd - currentOdd;
  const currentSum = chosenArr.reduce((a, b) => a + b, 0);

  const weights = candidates.map((n) => {
    let w = 1;

    // Risk penalties
    let risk = 0;
    if (chosen.has(n - 1) || chosen.has(n + 1)) risk += p.risk.consecutivePenalty * 0.5;
    if (n >= 1 && n <= 31) risk += p.risk.birthdayPenalty * 0.4;
    if (chosen.has(symmetricPartner(n))) risk += p.risk.symmetryPenalty * 0.5;
    w *= Math.max(0.15, 1 - risk);

    // Structure: odd/even
    if (needOdd > 0 && n % 2 === 1) w *= 1 + 0.4;
    else if (needOdd < 0 && n % 2 === 0) w *= 1 + 0.4;

    // Structure: low/high (mid splits range)
    const isHigh = n >= mid;
    if (p.structure.lowHighRatio > 0.55 && isHigh) w *= 1 + 0.35 * (p.structure.lowHighRatio - 0.5) * 2;
    else if (p.structure.lowHighRatio < 0.45 && !isHigh) w *= 1 + 0.35 * (0.5 - p.structure.lowHighRatio) * 2;

    // Structure: sum range (0=prefer low sum, 1=prefer high)
    const normPos = (n - p.mainMin) / range;
    w *= 1 + 0.3 * (normPos - 0.5) * (p.structure.sumRangeWeight - 0.5) * 2;

    // Structure: gap (prefer spread when high) and clustering (prefer clustered when high)
    const minDist = chosen.size === 0 ? range / 2 : Math.min(...chosenArr.map((c) => Math.abs(n - c)));
    const spreadScore = Math.min(1, minDist / (range / 4));
    w *= 1 + 0.25 * (p.structure.gapWeight - 0.5) * 2 * spreadScore;
    w *= 1 + 0.25 * (p.structure.clustering - 0.5) * 2 * (1 - spreadScore);

    // Position: edge bias (1=prefer edges like 1,49; 0=avoid)
    const edgeDist = Math.min(n - p.mainMin, p.mainMax - n);
    const edgeScore = 1 - edgeDist / (range / 2);
    w *= 1 + 0.3 * (p.position.edgeBias - 0.5) * 2 * Math.max(0, edgeScore);

    // Position: mid density (1=prefer middle; 0=avoid middle)
    const midDist = Math.abs(n - mid);
    const midScore = 1 - midDist / (range / 2);
    w *= 1 + 0.3 * (p.position.midDensity - 0.5) * 2 * Math.max(0, midScore);

    // Position freq: favor numbers in typical range for current slot
    const slotRatio = (chosen.size + 1) / (p.mainCount + 1);
    const typicalCenter = p.mainMin + range * slotRatio;
    const slotScore = 1 - Math.abs(n - typicalCenter) / (range / 2);
    w *= 1 + 0.2 * (p.position.positionFreq - 0.5) * 2 * Math.max(0, slotScore);

    // Lucky bias
    if (luckySet.has(n)) w *= 1 + luckyBoost;

    return Math.max(0.1, w);
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Map feature weights to generation params. */
function featureWeightsToParams(weights: Record<FeatureId, number>) {
  const oddEven = weights.odd_even ?? 0.5;
  const lowHigh = weights.low_high ?? 0.5;
  const sumRange = weights.sum_range ?? 0.5;
  const hotTrend = (weights.short_activity ?? 0.5) * 0.4 + (weights.recency_bias ?? 0.5) * 0.3;
  const coldTrend = 1 - (weights.long_deviation ?? 0.5) * 0.4;
  const gapWeight = (weights.max_gap ?? 0.5) * 0.5 + (weights.avg_gap ?? 0.5) * 0.5;
  const clustering = weights.clustering ?? 0.5;
  const edgeBias = weights.edge_bias ?? 0.5;
  const midDensity = weights.mid_density ?? 0.5;
  const positionFreq = weights.position_frequency ?? 0.5;
  const consecutivePenalty = weights.common_pattern_penalty ?? 0.5;
  const birthdayPenalty = weights.birthday_penalty ?? 0.5;
  const symmetryPenalty = weights.symmetry_penalty ?? 0.5;
  return {
    hotWeight: Math.max(0.2, Math.min(0.6, hotTrend)),
    coldWeight: Math.max(0.2, Math.min(0.6, coldTrend)),
    oddEvenRatio: oddEven,
    lowHighRatio: lowHigh,
    sumRangeWeight: sumRange,
    gapWeight,
    clustering,
    edgeBias,
    midDensity,
    positionFreq,
    consecutivePenalty,
    birthdayPenalty,
    symmetryPenalty,
  };
}

export function generateFromStrategySet(
  lotteryId: LotteryId,
  history: { winning_numbers: number[]; special_numbers?: number[] }[],
  set: StrategySet,
  count: number
): CandidatePick[] {
  const params = featureWeightsToParams(set.featureWeights);
  const def = LOTTERY_DEFS[lotteryId];
  if (!def) return [];

  const mainFreq: Record<number, number> = {};
  const specialFreq: Record<number, number> = {};
  for (let i = def.main_min; i <= def.main_max; i++) mainFreq[i] = 0;
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
  const mid = Math.floor((def.main_max - def.main_min + 1) / 2) + def.main_min;

  for (let i = 0; i < count; i++) {
    const main: number[] = [];
    const pool = [...Array(def.main_max - def.main_min + 1)].map((_, j) => def.main_min + j);
    const pickFromHot = Math.floor(def.main_count * params.hotWeight);
    const pickFromCold = Math.floor(def.main_count * params.coldWeight);
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
      const candidates = pool.filter((n) => !chosen.has(n));
      if (candidates.length === 0) break;
      const lucky = (set.luckyNumbers ?? []).filter((x) => x >= def.main_min && x <= def.main_max);
      const strength = set.luckyBiasStrength ?? 'off';
      const boost = strength === 'off' || lucky.length === 0 ? 0 : LUCKY_BIAS_MULTIPLIER[strength];
      const n = pickWithAllBiases(
        candidates,
        chosen,
        main,
        lucky,
        boost,
        {
          risk: {
            consecutivePenalty: params.consecutivePenalty,
            birthdayPenalty: params.birthdayPenalty,
            symmetryPenalty: params.symmetryPenalty,
          },
          structure: {
            oddEvenRatio: params.oddEvenRatio,
            lowHighRatio: params.lowHighRatio,
            sumRangeWeight: params.sumRangeWeight,
            gapWeight: params.gapWeight,
            clustering: params.clustering,
          },
          position: {
            edgeBias: params.edgeBias,
            midDensity: params.midDensity,
            positionFreq: params.positionFreq,
          },
          mainMin: def.main_min,
          mainMax: def.main_max,
          mainCount: def.main_count,
        }
      );
      chosen.add(n);
      main.push(n);
    }
    main.sort((a, b) => a - b);

    const oddCount = main.filter((x) => x % 2 === 1).length;
    const userPicksSpecial = !['lotto_max', 'lotto_649'].includes(lotteryId);
    const special = userPicksSpecial
      ? [Math.floor(Math.random() * (def.special_max || 49)) + 1]
      : [];

    const key = main.join(',') + (special.length ? '|' + special.join(',') : '');
    if (used.has(key)) {
      i--;
      continue;
    }
    used.add(key);

    picks.push({
      main,
      special,
      explanation: `Feature-weighted mix. Odd: ${oddCount}/${def.main_count}. For exploration only.`,
    });
  }

  return picks;
}
