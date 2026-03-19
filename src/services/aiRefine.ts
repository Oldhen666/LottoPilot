/**
 * AI Refine: adjusts feature weights based on shape feedback.
 * AI does NOT generate numbers. AI does NOT predict outcomes.
 * Only uses aggregated shape summaries. Adjustment capped at ±5%.
 */
import type {
  RefineInput,
  RefineProposal,
  FeatureDelta,
  ShapeSummary,
  OutcomeShapeSummary,
  DeltaSummary,
} from '../types/strategy';
import type { FeatureId } from '../constants/strategyFeatures';
import { STRATEGY_FEATURES } from '../constants/strategyFeatures';

const MAX_DELTA = 0.05;

function clampDelta(magnitude: number): number {
  return Math.max(0.01, Math.min(MAX_DELTA, magnitude));
}

export function computeShapeSummary(numbers: number[], mainMax: number): ShapeSummary {
  const mid = Math.floor(mainMax / 2);
  const oddCount = numbers.filter((n) => n % 2 === 1).length;
  const lowCount = numbers.filter((n) => n <= mid).length;
  const sum = numbers.reduce((a, b) => a + b, 0);
  const sorted = [...numbers].sort((a, b) => a - b);
  let maxGap = 0;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i] - sorted[i - 1];
    gaps.push(g);
    maxGap = Math.max(maxGap, g);
  }
  const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  return {
    oddCount,
    evenCount: numbers.length - oddCount,
    lowCount,
    highCount: numbers.length - lowCount,
    sum,
    maxGap,
    avgGap,
  };
}

export function computeDeltaSummary(
  picks: ShapeSummary,
  outcome: ShapeSummary
): DeltaSummary {
  const denom = (a: number, b: number) => Math.max(0.01, a + b);
  return {
    oddEvenDelta: (picks.oddCount - outcome.oddCount) / denom(picks.oddCount, picks.evenCount),
    lowHighDelta: (picks.lowCount - outcome.lowCount) / denom(picks.lowCount, picks.highCount),
    sumDelta: (picks.sum - outcome.sum) / Math.max(1, outcome.sum),
    gapDelta: ((picks.maxGap ?? 0) - (outcome.maxGap ?? 0)) / Math.max(1, outcome.maxGap ?? 1),
  };
}

/**
 * Rule-based refine: suggest small feature weight adjustments from shape delta.
 */
export function computeRefineProposal(input: RefineInput): RefineProposal {
  const deltas: FeatureDelta[] = [];
  const { picksShapeSummary, outcomeShapeSummary, deltaSummary } = input;

  if (Math.abs(deltaSummary.oddEvenDelta) > 0.2) {
    deltas.push({
      featureId: 'odd_even',
      direction: deltaSummary.oddEvenDelta > 0 ? 'decrease' : 'increase',
      magnitude: clampDelta(0.03),
    });
  }
  if (Math.abs(deltaSummary.lowHighDelta) > 0.2) {
    deltas.push({
      featureId: 'low_high',
      direction: deltaSummary.lowHighDelta > 0 ? 'decrease' : 'increase',
      magnitude: clampDelta(0.03),
    });
  }
  if (Math.abs(deltaSummary.sumDelta) > 0.15) {
    deltas.push({
      featureId: 'sum_range',
      direction: deltaSummary.sumDelta > 0 ? 'decrease' : 'increase',
      magnitude: clampDelta(0.02),
    });
  }
  if (Math.abs(deltaSummary.gapDelta) > 0.2) {
    deltas.push({
      featureId: 'max_gap',
      direction: deltaSummary.gapDelta > 0 ? 'decrease' : 'increase',
      magnitude: clampDelta(0.02),
    });
  }

  if (outcomeShapeSummary.matchCountMain === 0 && outcomeShapeSummary.matchCountSpecial === 0) {
    deltas.push({
      featureId: 'common_pattern_penalty',
      direction: 'decrease',
      magnitude: clampDelta(0.02),
    });
  }

  if (deltas.length === 0) {
    deltas.push({
      featureId: 'recency_bias',
      direction: 'decrease',
      magnitude: clampDelta(0.02),
    });
  }

  const unique = dedupeDeltas(deltas);
  const reasoning = buildReasoning(input, unique);

  return { deltas: unique, reasoning };
}

function dedupeDeltas(deltas: FeatureDelta[]): FeatureDelta[] {
  const seen = new Set<string>();
  return deltas.filter((d) => {
    if (seen.has(d.featureId)) return false;
    seen.add(d.featureId);
    return true;
  });
}

function buildReasoning(input: RefineInput, deltas: FeatureDelta[]): string {
  const parts: string[] = [];
  if (Math.abs(input.deltaSummary.oddEvenDelta) > 0.2) {
    parts.push('Odd/even balance differs from outcome. Adjusting odd_even weight to align.');
  }
  if (Math.abs(input.deltaSummary.lowHighDelta) > 0.2) {
    parts.push('Low/high split differs. Adjusting low_high weight.');
  }
  if (Math.abs(input.deltaSummary.sumDelta) > 0.15) {
    parts.push('Sum range offset detected. Refining sum_range.');
  }
  if (input.outcomeShapeSummary.matchCountMain === 0) {
    parts.push('No matches in last outcome. Reducing common_pattern_penalty to explore different patterns.');
  }
  if (parts.length === 0) {
    parts.push('Small adjustment to refine strategy behavior based on feedback. Does not predict lottery outcomes.');
  }
  if (input.luckyBiasStrength && input.luckyBiasStrength !== 'off') {
    parts.push('Lucky bias adds a personal preference layer; it does not affect draw probabilities.');
  }
  return parts.join(' ');
}
