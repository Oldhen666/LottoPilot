/**
 * Strategy Lab play style ids + human-readable labels (Auto Pilot + score readout).
 */
export const STRATEGY_PLAY_STYLE_IDS = ['balanced', 'aggressive', 'trend', 'safe', 'experimental'] as const;
export type StrategyPlayStyleId = (typeof STRATEGY_PLAY_STYLE_IDS)[number];

export const STRATEGY_PLAY_STYLE_LABEL: Record<StrategyPlayStyleId, string> = {
  balanced: 'Balanced and steady',
  aggressive: 'Aggressive but promising',
  trend: 'Trend-focused',
  safe: 'Safe but conservative',
  experimental: 'Experimental / high variance',
};

/** Short labels for dropdowns and score cards. */
export const STRATEGY_PLAY_STYLE_SHORT: Record<StrategyPlayStyleId, string> = {
  balanced: 'Balanced',
  aggressive: 'Aggressive',
  trend: 'Trend',
  safe: 'Safe',
  experimental: 'Experimental',
};

export function isStrategyPlayStyleId(v: unknown): v is StrategyPlayStyleId {
  return typeof v === 'string' && (STRATEGY_PLAY_STYLE_IDS as readonly string[]).includes(v);
}
