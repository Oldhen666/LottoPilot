/**
 * Unit tests for add-on engine
 */
import {
  computeExtraResult,
  computeEncoreResult,
  computeTagResult,
  computeDoublePlayResult,
  computeAddOnResults,
} from './addOnEngine';

describe('computeExtraResult', () => {
  it('matches digits right-to-left (3 digits = $2)', () => {
    const r = computeExtraResult('1234567', '1235567');
    expect(r).not.toBeNull();
    expect(r!.matchedDigits).toBe(3);
    expect(r!.prizeText).toBe('$2');
  });

  it('full match returns Jackpot', () => {
    const r = computeExtraResult('1234567', '1234567');
    expect(r).not.toBeNull();
    expect(r!.matchedDigits).toBe(7);
    expect(r!.prizeText).toBe('Jackpot');
  });

  it('no match returns null when winning missing', () => {
    expect(computeExtraResult('1234567', null)).toBeNull();
  });
});

describe('computeEncoreResult', () => {
  it('same logic as EXTRA', () => {
    const r = computeEncoreResult('7654321', '7654321');
    expect(r).not.toBeNull();
    expect(r!.matchedDigits).toBe(7);
  });
});

describe('computeTagResult', () => {
  it('6-digit position match (TAG)', () => {
    const r = computeTagResult('335939', '335939');
    expect(r).not.toBeNull();
    expect(r!.matchedDigits).toBe(6);
    expect(r!.prizeText).toBe('Jackpot');
  });

  it('6-digit partial match', () => {
    const r = computeTagResult('335930', '335939');
    expect(r).not.toBeNull();
    expect(r!.matchedDigits).toBe(5); // 33593 match, last digit 0 vs 9
  });
});

describe('computeDoublePlayResult', () => {
  it('5 main + PB match', () => {
    const r = computeDoublePlayResult(
      [1, 2, 3, 4, 5],
      [10],
      [1, 2, 3, 4, 5, 10]
    );
    expect(r).not.toBeNull();
    expect(r!.match_main).toBe(5);
    expect(r!.match_special).toBe(1);
    expect(r!.prizeText).toBe('Jackpot');
  });

  it('partial match (3 main, 0 special)', () => {
    const r = computeDoublePlayResult(
      [1, 2, 3, 10, 20],
      [5],
      [1, 2, 3, 4, 5, 10]
    );
    expect(r).not.toBeNull();
    expect(r!.match_main).toBe(3);
    expect(r!.match_special).toBe(0);
    expect(r!.prizeText).toBe('$7');
  });
});

describe('computeAddOnResults', () => {
  it('returns EXTRA when selected and data present', () => {
    const r = computeAddOnResults(
      { EXTRA: true },
      { EXTRA: '1234567' },
      { draw_date: '2025-01-01', winning_numbers: [], extra_number: '1234567' },
      [],
      undefined
    );
    expect(r.EXTRA).toBeDefined();
    expect(r.EXTRA!.matchedDigits).toBe(7);
  });

  it('returns POWER_PLAY with applied:true when selected', () => {
    const r = computeAddOnResults(
      { POWER_PLAY: true },
      {},
      { draw_date: '2025-01-01', winning_numbers: [], power_play_multiplier: 4 },
      [],
      undefined
    );
    expect(r.POWER_PLAY).toEqual({ multiplier: 4, applied: true });
  });

  it('returns POWER_PLAY with applied:false when not selected', () => {
    const r = computeAddOnResults(
      {},
      {},
      { draw_date: '2025-01-01', winning_numbers: [], power_play_multiplier: 4 },
      [],
      undefined
    );
    expect(r.POWER_PLAY).toEqual({ multiplier: 4, applied: false });
  });

  it('returns DOUBLE_PLAY placeholder when selected but no data', () => {
    const r = computeAddOnResults(
      { DOUBLE_PLAY: true },
      {},
      { draw_date: '2025-01-01', winning_numbers: [], double_play_numbers_json: null },
      [1, 2, 3, 4, 5],
      [10]
    );
    expect(r.DOUBLE_PLAY).toBeDefined();
    expect(r.DOUBLE_PLAY!.prizeText).toContain('not available');
  });
});
