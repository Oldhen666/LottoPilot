/**
 * Strategy Lab feature system: 14 features across 4 categories.
 * Each feature has a weight 0–1. Displayed as test tubes (height = weight).
 */

export type FeatureCategory = 'structure' | 'position' | 'trend' | 'risk';

export const FEATURE_CATEGORY_COLORS: Record<FeatureCategory, string> = {
  structure: '#4f46e5',   // indigo
  position: '#10b981',    // green
  trend: '#d4af37',       // gold
  risk: '#f59e0b',        // amber
};

export interface FeatureDef {
  id: string;
  label: string;
  category: FeatureCategory;
  defaultWeight: number;
}

export const STRATEGY_FEATURES: FeatureDef[] = [
  // Structure
  { id: 'odd_even', label: 'Odd/Even', category: 'structure', defaultWeight: 0.5 },
  { id: 'low_high', label: 'Low/High', category: 'structure', defaultWeight: 0.5 },
  { id: 'sum_range', label: 'Sum range', category: 'structure', defaultWeight: 0.5 },
  { id: 'sum_deviation', label: 'Sum deviation', category: 'structure', defaultWeight: 0.5 },
  { id: 'max_gap', label: 'Max gap', category: 'structure', defaultWeight: 0.5 },
  { id: 'avg_gap', label: 'Avg gap', category: 'structure', defaultWeight: 0.5 },
  { id: 'clustering', label: 'Clustering', category: 'structure', defaultWeight: 0.5 },
  // Position
  { id: 'position_frequency', label: 'Position freq', category: 'position', defaultWeight: 0.5 },
  { id: 'edge_bias', label: 'Edge bias', category: 'position', defaultWeight: 0.5 },
  { id: 'mid_density', label: 'Mid density', category: 'position', defaultWeight: 0.5 },
  // Trend
  { id: 'short_activity', label: 'Short activity', category: 'trend', defaultWeight: 0.5 },
  { id: 'long_deviation', label: 'Long deviation', category: 'trend', defaultWeight: 0.5 },
  { id: 'recency_bias', label: 'Recency bias', category: 'trend', defaultWeight: 0.5 },
  // Risk
  { id: 'common_pattern_penalty', label: 'Common penalty', category: 'risk', defaultWeight: 0.5 },
  { id: 'birthday_penalty', label: 'Birthday penalty', category: 'risk', defaultWeight: 0.5 },
  { id: 'symmetry_penalty', label: 'Symmetry penalty', category: 'risk', defaultWeight: 0.5 },
];

export type FeatureId = typeof STRATEGY_FEATURES[number]['id'];

export function getDefaultFeatureWeights(): Record<FeatureId, number> {
  const out: Record<string, number> = {};
  for (const f of STRATEGY_FEATURES) {
    out[f.id] = f.defaultWeight;
  }
  return out as Record<FeatureId, number>;
}
