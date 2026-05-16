/**
 * Strategy Lab feature system: 14 features across 4 categories.
 * Each feature has a weight 0–1. Shown in Strategy Lab as tuning rows (numeric + knob controls).
 */

export type FeatureCategory = 'structure' | 'position' | 'trend' | 'risk';

export const FEATURE_CATEGORY_COLORS: Record<FeatureCategory, string> = {
  structure: '#4f46e5', // indigo
  position: '#10b981', // green
  trend: '#d4af37', // gold
  risk: '#f59e0b', // amber
};

export interface FeatureDef {
  id: string;
  label: string;
  /** One-line hint for the tuning row (may ellipsize on narrow screens). */
  brief: string;
  /** Short labels for spectrum ends: left = weight 0, right = weight 1. */
  spectrumLeft: string;
  spectrumRight: string;
  /** Long copy for the tuning bottom sheet (body before shared footer). */
  detail: string;
  category: FeatureCategory;
  defaultWeight: number;
}

const DETAIL_SUFFIX =
  '\n\nThis parameter adjusts ranking inside Strategy Lab only. It does not change lottery randomness or true odds.';

export const STRATEGY_FEATURES: FeatureDef[] = [
  // Structure
  {
    id: 'odd_even',
    label: 'Odd/Even',
    spectrumLeft: 'Even',
    spectrumRight: 'Odd',
    brief: 'Balances how odd vs even the main numbers are.',
    detail:
      'Most draws use a mix of odd and even numbers on the main lines. Odd/Even controls how strongly your strategy prefers ticket shapes whose odd/even split looks believable for this game.\n\n' +
      'Toward Even: more emphasis on even-heavy shapes; toward Odd: odd-heavy shapes; balanced settings sit near typical splits. Lower weight means this signal barely moves ranking; higher weight makes odd/even shape matter more when comparing candidates.',
    category: 'structure',
    defaultWeight: 0.5,
  },
  {
    id: 'low_high',
    label: 'Low/High',
    spectrumLeft: 'Low',
    spectrumRight: 'High',
    brief: 'Splits picks between the low and high halves of the number range.',
    detail:
      'The playable range is split into a lower half and an upper half. Low/High shifts whether ranked picks lean toward smaller numbers, larger numbers, or stay neutral.\n\n' +
      'Use it to bias exploration toward one end of the board without ignoring the rest entirely. Stronger weight makes this split a sharper filter in the scoring mix.',
    category: 'structure',
    defaultWeight: 0.5,
  },
  {
    id: 'sum_range',
    label: 'Sum range',
    spectrumLeft: 'Tighter',
    spectrumRight: 'Wider',
    brief: 'Keeps the ticket sum closer to a typical band.',
    detail:
      'Ticket sum (main numbers added) often clusters in a band for each game. Sum range decides how tightly candidates must land near that band vs allowing more extreme totals.\n\n' +
      'Tighter favors “typical sum” shapes; Wider leaves room for unusually low or high sums when other signals agree.',
    category: 'structure',
    defaultWeight: 0.5,
  },
  {
    id: 'sum_deviation',
    label: 'Sum deviation',
    spectrumLeft: 'Classic',
    spectrumRight: 'Recent',
    brief: 'Penalizes sums that drift away from recent draw sums.',
    detail:
      'Compares each candidate’s sum against expectations anchored more in long-run patterns (Classic) vs draws from the last several games (Recent).\n\n' +
      'Raise weight when you want sum discipline to matter more in ranking; lower it if you prefer sum to be a soft hint.',
    category: 'structure',
    defaultWeight: 0.5,
  },
  {
    id: 'max_gap',
    label: 'Max gap',
    spectrumLeft: 'Small gaps',
    spectrumRight: 'Large gaps',
    brief: 'Controls the largest gap between sorted neighbors.',
    detail:
      'After sorting main numbers, “max gap” is the largest jump between neighbors. Some strategies prefer compact spacing; others allow one wide jump.\n\n' +
      'This weight scales how much the largest gap influences ticket ranking vs other structure cues.',
    category: 'structure',
    defaultWeight: 0.5,
  },
  {
    id: 'avg_gap',
    label: 'Avg gap',
    spectrumLeft: 'Tight',
    spectrumRight: 'Wide',
    brief: 'Shapes typical spacing between sorted numbers.',
    detail:
      'Average gap summarizes how spread out the sorted numbers are overall. Tight favors evenly spaced smaller intervals; Wide allows more breathing room between values.\n\n' +
      'It complements Max gap by shaping overall spacing, not only the single largest step.',
    category: 'structure',
    defaultWeight: 0.5,
  },
  {
    id: 'clustering',
    label: 'Clustering',
    spectrumLeft: 'Spread',
    spectrumRight: 'Clustered',
    brief: 'More clustering vs more spread across the board.',
    detail:
      'Clustered tickets bunch numbers into fewer neighborhoods on the line; Spread pushes values apart across the range.\n\n' +
      'Adjust weight to prefer tickets that look more “clumped” vs more evenly dispersed when scores are compared.',
    category: 'structure',
    defaultWeight: 0.5,
  },
  // Position
  {
    id: 'position_frequency',
    label: 'Position freq',
    spectrumLeft: 'Softer',
    spectrumRight: 'Stronger',
    brief: 'Uses draw-position buckets (which slots favor which numbers).',
    detail:
      'Some numbers appear more often in early vs late sort positions in historical draws. Position frequency uses those buckets to tilt picks.\n\n' +
      'Softer lets this signal nudge lightly; Stronger makes slot-history patterns weigh heavily when ranking lines.',
    category: 'position',
    defaultWeight: 0.5,
  },
  {
    id: 'edge_bias',
    label: 'Edge bias',
    spectrumLeft: 'Low end',
    spectrumRight: 'High end',
    brief: 'Tilts picks toward the low or high end of the range.',
    detail:
      'Edge bias shifts the generator’s preference toward the bottom of the number field, the top, or a neutral blend.\n\n' +
      'Useful when you want tickets that skew cold/low vs hot/high relative to the full range, independent of other shape rules.',
    category: 'position',
    defaultWeight: 0.5,
  },
  {
    id: 'mid_density',
    label: 'Mid density',
    spectrumLeft: 'Avoid mid',
    spectrumRight: 'Favor mid',
    brief: 'Emphasizes or avoids the middle band of the range.',
    detail:
      'The middle band is the central third (approximately) of playable numbers. This control prefers tickets that load into that band vs tickets that avoid it.\n\n' +
      'Higher weight makes mid-band presence or absence a stronger factor in the final ordering of candidates.',
    category: 'position',
    defaultWeight: 0.5,
  },
  // Trend
  {
    id: 'short_activity',
    label: 'Short activity',
    spectrumLeft: 'Calm',
    spectrumRight: 'Active',
    brief: 'Short-window hot/cold style activity signal.',
    detail:
      'Short activity looks at recent draws only and scores numbers by recent hit frequency—hot vs cold in a small window.\n\n' +
      'Calm reduces chase of short streaks; Active rewards numbers moving quickly in or out of favor recently.',
    category: 'trend',
    defaultWeight: 0.5,
  },
  {
    id: 'long_deviation',
    label: 'Long deviation',
    spectrumLeft: 'Stable',
    spectrumRight: 'Reactive',
    brief: 'Long-horizon overdue vs overplayed tendency.',
    detail:
      'Long deviation contrasts very long-run appearance rates with shorter windows—numbers “due” vs “overplayed” over many draws.\n\n' +
      'Stable treats long trends as gentle hints; Reactive lets long-run deviation swing rankings more when signals disagree.',
    category: 'trend',
    defaultWeight: 0.5,
  },
  {
    id: 'recency_bias',
    label: 'Recency bias',
    spectrumLeft: 'Blended',
    spectrumRight: 'Recent',
    brief: 'Extra tilt toward numbers seen in very recent draws.',
    detail:
      'Recency bias boosts numbers that appeared in the last one or two draws vs blending evenly with longer memory.\n\n' +
      'Blended keeps recent draws as one factor among many; Recent-heavy pushes lines that echo the very latest results harder to the top.',
    category: 'trend',
    defaultWeight: 0.5,
  },
  // Risk
  {
    id: 'common_pattern_penalty',
    label: 'Common penalty',
    spectrumLeft: 'Softer',
    spectrumRight: 'Stronger',
    brief: 'Down-weights cliché shapes people often play.',
    detail:
      'Common penalty identifies shapes many players tend to choose (dates, straight lines on play slips, famous combinations) and down-ranks them.\n\n' +
      'Softer applies a light discount; Stronger aggressively avoids crowded patterns when ties would split prizes more ways.',
    category: 'risk',
    defaultWeight: 0.5,
  },
  {
    id: 'birthday_penalty',
    label: 'Birthday penalty',
    spectrumLeft: 'Softer',
    spectrumRight: 'Stronger',
    brief: 'Reduces “birthday cluster” style tickets (many low numbers).',
    detail:
      'Birthday-style picks cluster in 1–31 and skew sums and spacing. This penalty discourages lines that look like many low birthdays packed together.\n\n' +
      'Stronger settings pull harder away from those clusters; Softer keeps the effect mild.',
    category: 'risk',
    defaultWeight: 0.5,
  },
  {
    id: 'symmetry_penalty',
    label: 'Symmetry penalty',
    spectrumLeft: 'Softer',
    spectrumRight: 'Stronger',
    brief: 'Avoids overly symmetric or mirror-like patterns.',
    detail:
      'Highly symmetric patterns (arithmetic progressions, mirrored pairs, perfectly even spacing) are scored lower when this is active.\n\n' +
      'Stronger symmetry avoidance filters decorative patterns more aggressively; Softer only nudges against the most obvious cases.',
    category: 'risk',
    defaultWeight: 0.5,
  },
];

export type FeatureId = (typeof STRATEGY_FEATURES)[number]['id'];

/**
 * Astronaut-only: adjustable in Strategy Lab + eligible for AI Refine.
 * Free/Pirate: locked UI (lock icon); Refine does not tune these.
 * Common penalty (`common_pattern_penalty`) is intentionally available on Free.
 */
export const ASTRONAUT_ONLY_FEATURE_IDS = new Set<FeatureId>([
  'sum_deviation',
  'max_gap',
  'avg_gap',
  'edge_bias',
  'mid_density',
  'birthday_penalty',
  'symmetry_penalty',
]);

export function isAstronautOnlyFeature(id: FeatureId): boolean {
  return ASTRONAUT_ONLY_FEATURE_IDS.has(id);
}

/** Common penalty uses discrete levels 0–5 (stored weight = level / 5). */
export const COMMON_PENALTY_LEVEL_MAX = 5;

export function isCommonPenaltyFeatureId(id: string): id is 'common_pattern_penalty' {
  return id === 'common_pattern_penalty';
}

export function commonPenaltyLevelFrom01(w01: number): number {
  const w = Math.max(0, Math.min(1, w01));
  return Math.max(0, Math.min(COMMON_PENALTY_LEVEL_MAX, Math.round(w * COMMON_PENALTY_LEVEL_MAX)));
}

export function commonPenalty01FromLevel(level: number): number {
  const k = Math.max(0, Math.min(COMMON_PENALTY_LEVEL_MAX, Math.round(level)));
  return k / COMMON_PENALTY_LEVEL_MAX;
}

export function snapCommonPenalty01(w01: number): number {
  return commonPenalty01FromLevel(commonPenaltyLevelFrom01(w01));
}

/**
 * Preview / apply a single Refine delta on a 0–1 weight.
 * `common_pattern_penalty` uses discrete levels 0–5: refine moves ±1 level (continuous ±% would snap away).
 */
export function featureWeight01AfterRefineDelta(
  featureId: FeatureId,
  before01: number,
  delta: { direction: 'increase' | 'decrease'; magnitude: number }
): number {
  if (featureId === 'common_pattern_penalty') {
    const level = commonPenaltyLevelFrom01(before01);
    const nextLevel =
      delta.direction === 'increase'
        ? Math.min(COMMON_PENALTY_LEVEL_MAX, level + 1)
        : Math.max(0, level - 1);
    return commonPenalty01FromLevel(nextLevel);
  }
  const step = delta.direction === 'increase' ? delta.magnitude : -delta.magnitude;
  return Math.max(0, Math.min(1, before01 + step));
}

export function getCommonPenaltyIndication(level: number): string {
  if (level <= 1) return 'Softer';
  if (level >= 4) return 'Stronger';
  return 'Balanced';
}

/** Body text for tuning bottom sheet (includes shared disclaimer). */
export function getFeatureDetailCopy(feature: FeatureDef): string {
  return feature.detail + DETAIL_SUFFIX;
}

/** Short qualitative tag from weight position (0 = left pole, 1 = right pole). */
export function getWeightIndication(feature: FeatureDef, w01: number): string {
  const w = Math.max(0, Math.min(1, w01));
  if (feature.id === 'common_pattern_penalty') {
    return getCommonPenaltyIndication(commonPenaltyLevelFrom01(w));
  }
  if (w <= 1 / 3) return `${feature.spectrumLeft}-heavy`;
  if (w >= 2 / 3) return `${feature.spectrumRight}-heavy`;
  return 'Balanced';
}

export function getDefaultFeatureWeights(): Record<FeatureId, number> {
  const out: Record<string, number> = {};
  for (const f of STRATEGY_FEATURES) {
    out[f.id] = f.defaultWeight;
  }
  return out as Record<FeatureId, number>;
}
