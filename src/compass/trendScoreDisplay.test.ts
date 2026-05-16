import { buildTrendReferenceDisplayByNumber, trendDisplayFromPoolRank } from './trendScoreDisplay';
import type { NumberTrendScore } from './types';

function row(n: number, trendScore: number): NumberTrendScore {
  return {
    number: n,
    longFreq: 0,
    shortFreq: 0,
    baselineFreq: 0,
    trendScore,
    level: 'NEUTRAL',
    zLong: 0,
    zShort: 0,
    recentActivity: 0,
    longTermDeviation: 0,
  };
}

describe('trendScoreDisplay', () => {
  it('maps rank to ~6..97 across pool', () => {
    expect(trendDisplayFromPoolRank(0, 5)).toBe(97);
    expect(trendDisplayFromPoolRank(4, 5)).toBe(6);
    expect(trendDisplayFromPoolRank(0, 1)).toBe(52);
  });

  it('buildTrendReferenceDisplayByNumber spans display range', () => {
    const rows = [row(1, 10), row(2, 50), row(3, 90)];
    const m = buildTrendReferenceDisplayByNumber(rows);
    expect(m.get(3)).toBe(97);
    expect(m.get(1)).toBe(6);
    expect(m.get(2)).toBeGreaterThan(6);
    expect(m.get(2)).toBeLessThan(97);
  });
});
