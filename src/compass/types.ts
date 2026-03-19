/** Compass types - historical distribution & trend scoring (reference only, not prediction) */

export type TrendLevel = 'LOW' | 'NEUTRAL' | 'HIGH';

export interface NumberTrendScore {
  number: number;
  longFreq: number;
  shortFreq: number;
  baselineFreq: number;
  trendScore: number;
  level: TrendLevel;
  zLong: number;
  zShort: number;
  recentActivity: number;
  longTermDeviation: number;
}

export interface PositionTopK {
  position: number;
  topKList: Array<{ number: number; count: number }>;
  topNumber: number;
}

export interface ShapeStats {
  oddEven: { odd: { min: number; max: number }; even: { min: number; max: number } };
  lowHigh: { low: { min: number; max: number }; high: { min: number; max: number } };
  sum: { min: number; max: number };
  gaps: { min: number; max: number };
}

export interface CompassPayload {
  gameCode: string;
  trendScores: NumberTrendScore[];
  positionTopK: PositionTopK[];
  shapeStats: ShapeStats;
  meta: {
    longDraws: number;
    shortDraws: number;
    longWindowDays: number;
    shortWindowDays: number;
    computedAt: string;
  };
}

export interface CompassConfig {
  longWindowDays: number;
  shortWindowDays: number;
  wShort: number;
  wLong: number;
  wRecency: number;
  topK: number;
  minDrawsRequired: number;
}

export const DEFAULT_COMPASS_CONFIG: CompassConfig = {
  longWindowDays: 3650,
  shortWindowDays: 180,
  wShort: 0.6,
  wLong: 0.3,
  wRecency: 0.1,
  topK: 5,
  minDrawsRequired: 100,
};
