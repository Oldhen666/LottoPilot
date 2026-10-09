/**
 * Auto Pilot: preset feature weights per selected play style (± local tweaks from defaults).
 */
import { getDefaultFeatureWeights, snapCommonPenalty01, type FeatureId } from '../constants/strategyFeatures';
import { STRATEGY_PLAY_STYLE_IDS, type StrategyPlayStyleId } from '../constants/strategyPlayStyle';

export function getAutoPilotPresetWeights(style: StrategyPlayStyleId): Record<FeatureId, number> {
  const w: Record<FeatureId, number> = { ...getDefaultFeatureWeights() };

  switch (style) {
    case 'balanced':
      break;
    case 'trend':
      w.short_activity = 0.76;
      w.recency_bias = 0.72;
      w.long_deviation = 0.34;
      w.position_frequency = 0.58;
      break;
    case 'safe':
      w.short_activity = 0.32;
      w.recency_bias = 0.38;
      w.long_deviation = 0.56;
      w.sum_range = 0.36;
      w.odd_even = 0.5;
      w.low_high = 0.48;
      w.common_pattern_penalty = 0.56;
      w.max_gap = 0.42;
      break;
    case 'aggressive':
      w.short_activity = 0.58;
      w.recency_bias = 0.62;
      w.sum_range = 0.68;
      w.odd_even = 0.58;
      w.max_gap = 0.62;
      w.avg_gap = 0.58;
      w.clustering = 0.42;
      break;
    case 'experimental':
      w.common_pattern_penalty = 0.28;
      w.symmetry_penalty = 0.36;
      w.max_gap = 0.64;
      w.clustering = 0.56;
      w.short_activity = 0.55;
      w.recency_bias = 0.48;
      break;
    default:
      break;
  }

  const cpp = w.common_pattern_penalty;
  if (typeof cpp === 'number') {
    w.common_pattern_penalty = snapCommonPenalty01(cpp);
  }
  return w;
}

/** Closest preset style by L1 distance to current weights (Manual tuning → shared play style label). */
export function inferNearestPlayStyleId(weights: Record<FeatureId, number>): StrategyPlayStyleId {
  let best: StrategyPlayStyleId = 'balanced';
  let bestDist = Infinity;
  for (const id of STRATEGY_PLAY_STYLE_IDS) {
    const preset = getAutoPilotPresetWeights(id);
    let d = 0;
    for (const fid of Object.keys(preset) as FeatureId[]) {
      const a = weights[fid] ?? 0.5;
      const b = preset[fid] ?? 0.5;
      d += Math.abs(a - b);
    }
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}
