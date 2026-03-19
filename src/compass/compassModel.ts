/**
 * Compass model: fixed statistical formulas for historical distribution & trend scoring.
 * Reference only - no prediction claims. Reproducible, deterministic.
 */
import type {
  CompassPayload,
  CompassConfig,
  NumberTrendScore,
  PositionTopK,
  ShapeStats,
  TrendLevel,
} from './types';
import { DEFAULT_COMPASS_CONFIG } from './types';

export interface DrawRecord {
  draw_date: string;
  winning_numbers: number[];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function normalizeTo0_100(x: number): number {
  const min = -3;
  const max = 3;
  const t = (x - min) / (max - min);
  return clamp(t * 100, 0, 100);
}

function scoreToLevel(score: number): TrendLevel {
  if (score < 34) return 'LOW';
  if (score < 67) return 'NEUTRAL';
  return 'HIGH';
}

/** Filter draws by date window (UTC date string YYYY-MM-DD) */
export function filterDrawsByWindow(
  draws: DrawRecord[],
  refDate: Date,
  windowDays: number
): DrawRecord[] {
  const cutoff = new Date(refDate);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return draws.filter((d) => d.draw_date >= cutoffStr && d.draw_date <= refDate.toISOString().slice(0, 10));
}

/** Compute trend scores for each number */
function computeTrendScores(
  draws: DrawRecord[],
  maxRange: number,
  picksPerDraw: number,
  config: CompassConfig,
  refDate: Date
): NumberTrendScore[] {
  const longDraws = filterDrawsByWindow(draws, refDate, config.longWindowDays);
  const shortDraws = filterDrawsByWindow(draws, refDate, config.shortWindowDays);

  const baseRate = 1 / maxRange;
  const epsilon = 1e-8;

  const longCount: Record<number, number> = {};
  const shortCount: Record<number, number> = {};
  for (let n = 1; n <= maxRange; n++) {
    longCount[n] = 0;
    shortCount[n] = 0;
  }

  for (const d of longDraws) {
    for (const n of d.winning_numbers) {
      if (n >= 1 && n <= maxRange) longCount[n]++;
    }
  }
  for (const d of shortDraws) {
    for (const n of d.winning_numbers) {
      if (n >= 1 && n <= maxRange) shortCount[n]++;
    }
  }

  const longTotal = longDraws.length * picksPerDraw || 1;
  const shortTotal = shortDraws.length * picksPerDraw || 1;

  const baseStd = Math.sqrt((baseRate * (1 - baseRate)) / longTotal) + epsilon;
  const baseStdShort = Math.sqrt((baseRate * (1 - baseRate)) / shortTotal) + epsilon;

  const results: NumberTrendScore[] = [];
  for (let n = 1; n <= maxRange; n++) {
    const longRate = longCount[n] / longTotal;
    const shortRate = shortCount[n] / shortTotal;

    const zLong = (longRate - baseRate) / baseStd;
    const zShort = (shortRate - baseRate) / baseStdShort;

    const longTermDeviation = Math.abs(zLong);
    const recentActivity = zShort;

    const scoreRaw =
      config.wShort * zShort +
      config.wLong * -longTermDeviation +
      config.wRecency * Math.max(0, zShort);

    const trendScore = clamp(normalizeTo0_100(scoreRaw), 0, 100);
    const level = scoreToLevel(trendScore);

    results.push({
      number: n,
      longFreq: longRate,
      shortFreq: shortRate,
      baselineFreq: baseRate,
      trendScore,
      level,
      zLong,
      zShort,
      recentActivity,
      longTermDeviation,
    });
  }
  return results;
}

/** Compute position Top K (numbers sorted ascending per draw). Sparse counting for speed. */
function computePositionTopK(
  draws: DrawRecord[],
  picksPerDraw: number,
  maxRange: number,
  topK: number
): PositionTopK[] {
  const posCount: Record<number, Record<number, number>> = {};
  for (let pos = 1; pos <= picksPerDraw; pos++) posCount[pos] = {};

  for (const d of draws) {
    const sorted = [...d.winning_numbers].filter((n) => n >= 1 && n <= maxRange).sort((a, b) => a - b);
    for (let i = 0; i < Math.min(picksPerDraw, sorted.length); i++) {
      const pos = i + 1;
      const n = sorted[i];
      posCount[pos][n] = (posCount[pos][n] ?? 0) + 1;
    }
  }

  const results: PositionTopK[] = [];
  for (let pos = 1; pos <= picksPerDraw; pos++) {
    const counts = Object.entries(posCount[pos])
      .map(([n, c]) => ({ number: parseInt(n, 10), count: c }))
      .sort((a, b) => b.count - a.count);
    const topKList = counts.slice(0, topK);
    const topNumber = topKList[0]?.number ?? 0;
    results.push({ position: pos, topKList, topNumber });
  }
  return results;
}

/** Compute shape stats (odd/even, low/high, sum, gaps) */
function computeShapeStats(
  draws: DrawRecord[],
  picksPerDraw: number,
  maxRange: number
): ShapeStats {
  const mid = Math.ceil(maxRange / 2);
  const oddCounts: number[] = [];
  const evenCounts: number[] = [];
  const lowCounts: number[] = [];
  const highCounts: number[] = [];
  const sums: number[] = [];
  const gapMaxs: number[] = [];

  for (const d of draws) {
    const main = d.winning_numbers.slice(0, picksPerDraw).filter((n) => n >= 1 && n <= maxRange);
    if (main.length < picksPerDraw) continue;
    const sorted = [...main].sort((a, b) => a - b);

    let odd = 0;
    let low = 0;
    for (const n of sorted) {
      if (n % 2 === 1) odd++;
      if (n <= mid) low++;
    }
    oddCounts.push(odd);
    evenCounts.push(picksPerDraw - odd);
    lowCounts.push(low);
    highCounts.push(picksPerDraw - low);
    sums.push(sorted.reduce((a, b) => a + b, 0));

    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
    }
    gapMaxs.push(maxGap);
  }

  const p = (arr: number[]) => ({
    min: arr.length ? Math.min(...arr) : 0,
    max: arr.length ? Math.max(...arr) : 0,
  });

  return {
    oddEven: { odd: p(oddCounts), even: p(evenCounts) },
    lowHigh: { low: p(lowCounts), high: p(highCounts) },
    sum: p(sums),
    gaps: p(gapMaxs),
  };
}

/** Main compute: produces full Compass payload */
export function computeCompass(
  draws: DrawRecord[],
  gameCode: string,
  picksPerDraw: number,
  maxRange: number,
  config: Partial<CompassConfig> = {}
): CompassPayload | null {
  const cfg = { ...DEFAULT_COMPASS_CONFIG, ...config };
  if (draws.length < cfg.minDrawsRequired) return null;

  const refDate = new Date();
  const longDraws = filterDrawsByWindow(draws, refDate, cfg.longWindowDays);
  const shortDraws = filterDrawsByWindow(draws, refDate, cfg.shortWindowDays);

  const trendScores = computeTrendScores(draws, maxRange, picksPerDraw, cfg, refDate);
  const positionTopK = computePositionTopK(draws, picksPerDraw, maxRange, cfg.topK);
  const shapeStats = computeShapeStats(draws, picksPerDraw, maxRange);

  return {
    gameCode,
    trendScores,
    positionTopK,
    shapeStats,
    meta: {
      longDraws: longDraws.length,
      shortDraws: shortDraws.length,
      longWindowDays: cfg.longWindowDays,
      shortWindowDays: cfg.shortWindowDays,
      computedAt: new Date().toISOString(),
    },
  };
}
