/**
 * Strategy Lab types: feature-driven, AI-assisted refinement.
 * Does NOT predict outcomes. Refines strategy behavior based on feedback.
 */

import type { FeatureId } from '../constants/strategyFeatures';

export type LuckyBiasStrength = 'off' | 'low' | 'medium' | 'high';

export interface StrategySet {
  id: string;
  name: string;
  lotteryId: string;
  featureWeights: Record<FeatureId, number>;
  /** 1–3 lucky numbers (personal preference, not statistical signal). Optional. */
  luckyNumbers?: number[];
  /** Lucky bias strength. Max influence ≤5%. Only affects balanced-pool selection. */
  luckyBiasStrength?: LuckyBiasStrength;
  createdAt: string; // ISO
}

export interface ShapeSummary {
  oddCount: number;
  evenCount: number;
  lowCount: number;
  highCount: number;
  sum: number;
  maxGap: number;
  avgGap?: number;
  clustering?: number;
}

export interface OutcomeShapeSummary {
  matchCountMain: number;
  matchCountSpecial: number;
  resultBucket: string;
}

export interface DeltaSummary {
  oddEvenDelta: number;
  lowHighDelta: number;
  sumDelta: number;
  gapDelta: number;
}

export interface RefineInput {
  strategySetId: string;
  lotteryId: string;
  mainMax: number;
  picksShapeSummary: ShapeSummary;   // from user's picks
  outcomeShapeSummary: OutcomeShapeSummary;  // match counts, result
  outcomeShapeSummaryForDelta?: ShapeSummary;  // from winning numbers, for delta
  deltaSummary: DeltaSummary;
  /** When set, AI may mention lucky bias impact on strategy personality. Must NOT reinforce as effective signal. */
  luckyBiasStrength?: LuckyBiasStrength;
}

export interface FeatureDelta {
  featureId: FeatureId;
  direction: 'increase' | 'decrease';
  magnitude: number; // 0–0.05 (±5% max)
}

export interface RefineProposal {
  deltas: FeatureDelta[];
  reasoning: string;
}

/** Legacy compatibility: AnalysisWeights for generateCandidates bridge */
export interface AnalysisWeights {
  hotWeight: number;
  coldWeight: number;
  oddEvenRatio: number;
  consecutivePenalty: number;
}
