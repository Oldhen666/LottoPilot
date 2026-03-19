/**
 * AI-Assisted Strategy Refinement: rule-based adjustment engine.
 * Produces parameter deltas (±5% max) based on strategy usage and outcomes.
 * Does NOT predict future outcomes. Refines strategy behavior only.
 */
import type {
  AIAdjustmentInput,
  AIAdjustmentProposal,
  ParameterDelta,
  ConfidenceLevel,
} from '../types/strategy';
import type { AnalysisWeights } from '../utils/localAnalysis';

const MAX_DELTA = 0.05;

function clampDelta(magnitude: number): number {
  return Math.max(0.01, Math.min(MAX_DELTA, magnitude));
}

/**
 * Rule-based adjustment: analyze input and suggest small parameter changes.
 */
export function computeAIAdjustment(input: AIAdjustmentInput): AIAdjustmentProposal {
  const deltas: ParameterDelta[] = [];
  const { strategyProfileSnapshot, outcomeShapeSummary, validationMetrics, flags } = input;

  // Overfitting: reduce hot weight, increase cold
  if (flags.overfitting) {
    deltas.push({
      param: 'hotWeight',
      direction: 'decrease',
      magnitude: clampDelta(0.03),
    });
    deltas.push({
      param: 'coldWeight',
      direction: 'increase',
      magnitude: clampDelta(0.02),
    });
  }

  // Instability: move toward balanced odd/even
  if (flags.instability) {
    const current = strategyProfileSnapshot.params.oddEvenRatio;
    if (current < 0.45) {
      deltas.push({ param: 'oddEvenRatio', direction: 'increase', magnitude: clampDelta(0.03) });
    } else if (current > 0.55) {
      deltas.push({ param: 'oddEvenRatio', direction: 'decrease', magnitude: clampDelta(0.03) });
    }
  }

  // Low alignment: slight shift toward cold (diversify)
  if (validationMetrics.alignment < 0.4) {
    const hasCold = deltas.some((d) => d.param === 'coldWeight');
    if (!hasCold) {
      deltas.push({
        param: 'coldWeight',
        direction: 'increase',
        magnitude: clampDelta(0.02),
      });
    }
  }

  // Poor outcome (no match): reduce consecutive penalty to allow more spread
  if (outcomeShapeSummary.matchCountMain === 0 && outcomeShapeSummary.matchCountSpecial === 0) {
    const current = strategyProfileSnapshot.params.consecutivePenalty;
    if (current > 0.4) {
      deltas.push({
        param: 'consecutivePenalty',
        direction: 'decrease',
        magnitude: clampDelta(0.02),
      });
    }
  }

  // Default: if no flags, suggest small diversification
  if (deltas.length === 0 || validationMetrics.baselineDelta > 0.5) {
    deltas.push({
      param: 'hotWeight',
      direction: validationMetrics.alignment > 0.5 ? 'increase' : 'decrease',
      magnitude: clampDelta(0.02),
    });
  }

  // Deduplicate: keep first occurrence per param
  const seen = new Set<string>();
  const unique = deltas.filter((d) => {
    const k = d.param;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const confidence: ConfidenceLevel =
    unique.length > 2 || flags.overfitting || flags.instability ? 'medium' : 'low';

  const reasoning = buildReasoning(input, unique);

  return {
    deltas: unique,
    reasoning,
    confidence,
  };
}

function buildReasoning(input: AIAdjustmentInput, deltas: ParameterDelta[]): string {
  const parts: string[] = [];
  if (input.flags.overfitting) {
    parts.push('Recent patterns suggest over-reliance on hot numbers. Reducing hot weight and increasing cold weight may diversify the strategy.');
  }
  if (input.flags.instability) {
    parts.push('Odd/even balance is shifting. Moving toward a more balanced ratio may improve stability.');
  }
  if (input.validationMetrics.alignment < 0.4) {
    parts.push('Picks have shown low alignment with historical shape. A slight cold-weight increase may broaden the selection.');
  }
  if (input.outcomeShapeSummary.matchCountMain === 0 && input.outcomeShapeSummary.matchCountSpecial === 0) {
    parts.push('Last outcome had no matches. Reducing consecutive penalty may allow more spread in number selection.');
  }
  if (parts.length === 0) {
    parts.push('Small adjustment to refine strategy behavior based on past usage. Does not predict future outcomes.');
  }
  return parts.join(' ');
}

/**
 * Build AI input from check records and current profile.
 */
export function buildAIInput(
  lotteryId: string,
  profile: { version: number; lotteryId: string; createdAt: string; params: AnalysisWeights },
  records: Array<{
    user_numbers: number[];
    user_special?: number[];
    winning_numbers: number[];
    winning_special?: number[];
    match_count_main: number;
    match_count_special: number;
    result_bucket: string;
  }>,
  kValue: number
): AIAdjustmentInput | null {
  if (records.length === 0) return null;

  const latest = records[0];
  const nums = latest.user_numbers || [];
  const mainMax = Math.max(...nums, 49);
  const mid = Math.floor(mainMax / 2);

  const oddCount = nums.filter((n) => n % 2 === 1).length;
  const lowCount = nums.filter((n) => n <= mid).length;
  const sum = nums.reduce((a, b) => a + b, 0);
  const sorted = [...nums].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  }

  const alignment = computeAlignment(nums, records);
  const stability = computeStability(records);
  const baselineDelta = Math.abs(profile.params.hotWeight - 0.4) + Math.abs(profile.params.coldWeight - 0.3);

  const overfitting = profile.params.hotWeight > 0.5 && alignment < 0.5;
  const instability = stability < 0.5 && records.length >= 2;

  return {
    strategyProfileSnapshot: {
      version: profile.version,
      lotteryId: profile.lotteryId,
      createdAt: profile.createdAt,
      params: { ...profile.params },
    },
    userPreferenceProfile: { kValue, lotteryId },
    picksShapeSummary: {
      oddCount,
      evenCount: nums.length - oddCount,
      lowCount,
      highCount: nums.length - lowCount,
      sum,
      maxGap,
    },
    outcomeShapeSummary: {
      matchCountMain: latest.match_count_main,
      matchCountSpecial: latest.match_count_special,
      resultBucket: latest.result_bucket,
    },
    validationMetrics: {
      alignment,
      stability,
      baselineDelta,
    },
    flags: { overfitting, instability },
  };
}

function computeAlignment(picks: number[], records: any[]): number {
  if (records.length < 2) return 0.5;
  const oddCount = picks.filter((n) => n % 2 === 1).length;
  const ratio = oddCount / Math.max(1, picks.length);
  return Math.min(1, 0.5 + Math.abs(ratio - 0.5)); // 0.5 = balanced
}

function computeStability(records: any[]): number {
  if (records.length < 2) return 0.5;
  const sums = records.map((r) => {
    const n = r.user_numbers || [];
    return n.reduce((a: number, b: number) => a + b, 0);
  });
  const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
  const variance = sums.reduce((a, s) => a + (s - avg) ** 2, 0) / sums.length;
  const std = Math.sqrt(variance);
  return Math.max(0, 1 - std / 500); // 500 = rough scale
}
