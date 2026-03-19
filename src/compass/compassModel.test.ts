/**
 * Compass model unit tests.
 * Covers: window filtering, trendScore range, positionTopK reproducibility, insufficient data.
 */
import {
  filterDrawsByWindow,
  computeCompass,
  type DrawRecord,
} from './compassModel';
import { DEFAULT_COMPASS_CONFIG } from './types';

function makeDraws(count: number, startDate: string, stepDays = 7): DrawRecord[] {
  const draws: DrawRecord[] = [];
  const d = new Date(startDate);
  for (let i = 0; i < count; i++) {
    const date = new Date(d);
    date.setDate(date.getDate() + i * stepDays);
    draws.push({
      draw_date: date.toISOString().slice(0, 10),
      winning_numbers: [1, 7, 14, 21, 28, 35, 42],
    });
  }
  return draws;
}

describe('filterDrawsByWindow', () => {
  it('filters draws by long window correctly', () => {
    const draws = makeDraws(200, '2020-01-01');
    const ref = new Date('2024-06-15');
    const filtered = filterDrawsByWindow(draws, ref, 365);
    expect(filtered.length).toBeLessThanOrEqual(draws.length);
    expect(filtered.every((d) => d.draw_date >= '2023-06-15' && d.draw_date <= '2024-06-15')).toBe(true);
  });

  it('filters draws by short window (180 days) correctly', () => {
    const draws = makeDraws(100, '2024-01-01');
    const ref = new Date('2024-06-20');
    const filtered = filterDrawsByWindow(draws, ref, 180);
    const cutoff = '2023-12-23';
    expect(filtered.every((d) => d.draw_date >= cutoff && d.draw_date <= '2024-06-20')).toBe(true);
  });

  it('returns empty when no draws in window', () => {
    const draws = makeDraws(10, '2010-01-01');
    const ref = new Date('2024-06-15');
    const filtered = filterDrawsByWindow(draws, ref, 30);
    expect(filtered.length).toBe(0);
  });
});

describe('computeCompass', () => {
  it('returns null when draws < minDrawsRequired', () => {
    const draws = makeDraws(50, '2024-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49);
    expect(result).toBeNull();
  });

  it('returns null when minDrawsRequired overridden and insufficient', () => {
    const draws = makeDraws(20, '2024-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49, { minDrawsRequired: 50 });
    expect(result).toBeNull();
  });

  it('returns payload when draws >= minDrawsRequired', () => {
    const draws = makeDraws(120, '2023-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49);
    expect(result).not.toBeNull();
    expect(result!.gameCode).toBe('lotto_max');
    expect(result!.trendScores.length).toBe(49);
    expect(result!.positionTopK.length).toBe(7);
    expect(result!.shapeStats).toBeDefined();
  });

  it('trendScore is in range 0-100 for all numbers', () => {
    const draws = makeDraws(120, '2023-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49);
    expect(result).not.toBeNull();
    for (const ts of result!.trendScores) {
      expect(ts.trendScore).toBeGreaterThanOrEqual(0);
      expect(ts.trendScore).toBeLessThanOrEqual(100);
    }
  });

  it('trendScore level is LOW, NEUTRAL, or HIGH', () => {
    const draws = makeDraws(120, '2023-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49);
    expect(result).not.toBeNull();
    const levels = ['LOW', 'NEUTRAL', 'HIGH'];
    for (const ts of result!.trendScores) {
      expect(levels).toContain(ts.level);
    }
  });

  it('positionTopK is reproducible for same input', () => {
    const draws = makeDraws(120, '2023-01-01');
    const r1 = computeCompass(draws, 'lotto_max', 7, 49);
    const r2 = computeCompass(draws, 'lotto_max', 7, 49);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.positionTopK.length).toBe(r2!.positionTopK.length);
    for (let i = 0; i < r1!.positionTopK.length; i++) {
      expect(r1!.positionTopK[i].position).toBe(r2!.positionTopK[i].position);
      expect(r1!.positionTopK[i].topNumber).toBe(r2!.positionTopK[i].topNumber);
      expect(r1!.positionTopK[i].topKList.map((x) => x.number)).toEqual(
        r2!.positionTopK[i].topKList.map((x) => x.number)
      );
    }
  });

  it('positionTopK has correct structure (pos 1..7, topKList)', () => {
    const draws = makeDraws(120, '2023-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49);
    expect(result).not.toBeNull();
    for (let pos = 1; pos <= 7; pos++) {
      const p = result!.positionTopK.find((x) => x.position === pos);
      expect(p).toBeDefined();
      expect(p!.topKList.length).toBeLessThanOrEqual(DEFAULT_COMPASS_CONFIG.topK);
      expect(p!.topNumber).toBe(p!.topKList[0]?.number ?? 0);
    }
  });

  it('shapeStats has valid odd/even, low/high, sum, gaps', () => {
    const draws = makeDraws(120, '2023-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49);
    expect(result).not.toBeNull();
    const s = result!.shapeStats;
    expect(s.oddEven.odd.min).toBeGreaterThanOrEqual(0);
    expect(s.oddEven.odd.max).toBeLessThanOrEqual(7);
    expect(s.lowHigh.low.min).toBeGreaterThanOrEqual(0);
    expect(s.lowHigh.low.max).toBeLessThanOrEqual(7);
    expect(s.sum.min).toBeLessThanOrEqual(s.sum.max);
    expect(s.gaps.min).toBeLessThanOrEqual(s.gaps.max);
  });

  it('meta contains longDraws, shortDraws, window config', () => {
    const draws = makeDraws(120, '2023-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49);
    expect(result).not.toBeNull();
    expect(result!.meta.longDraws).toBeGreaterThanOrEqual(0);
    expect(result!.meta.shortDraws).toBeGreaterThanOrEqual(0);
    expect(result!.meta.longWindowDays).toBe(DEFAULT_COMPASS_CONFIG.longWindowDays);
    expect(result!.meta.shortWindowDays).toBe(DEFAULT_COMPASS_CONFIG.shortWindowDays);
    expect(result!.meta.computedAt).toBeDefined();
  });

  it('works with custom config (topK, minDrawsRequired)', () => {
    const draws = makeDraws(80, '2023-01-01');
    const result = computeCompass(draws, 'lotto_max', 7, 49, {
      minDrawsRequired: 50,
      topK: 3,
    });
    expect(result).not.toBeNull();
    expect(result!.positionTopK[0].topKList.length).toBeLessThanOrEqual(3);
  });
});
