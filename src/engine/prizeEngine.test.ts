/**
 * Unit tests: match logic (shared with prize engine)
 */
import { checkTicket } from '../utils/check';
import { LOTTERY_DEFS } from '../constants/lotteries';

describe('checkTicket (match logic)', () => {
  const def = LOTTERY_DEFS.lotto_max;
  const winningMain = [1, 2, 3, 4, 5, 6, 7];
  const winningSpecial = [8];

  it('Lotto Max: no match', () => {
    const r = checkTicket(
      [10, 11, 12, 13, 14, 15, 16],
      undefined,
      winningMain,
      winningSpecial,
      def
    );
    expect(r.match_count_main).toBe(0);
    expect(r.match_count_special).toBe(0);
    expect(r.result_bucket).toBe('no_win');
  });

  it('Lotto Max: 6 main match (small hit)', () => {
    const r = checkTicket(
      [1, 2, 3, 4, 5, 6, 10],
      undefined,
      winningMain,
      winningSpecial,
      def
    );
    expect(r.match_count_main).toBe(6);
    expect(r.match_count_special).toBe(0);
    expect(r.result_bucket).toBe('small_hit');
  });

  it('Lotto Max: 7 main + bonus (jackpot)', () => {
    const r = checkTicket(
      [1, 2, 3, 4, 5, 6, 8],
      undefined,
      winningMain,
      winningSpecial,
      def
    );
    expect(r.match_count_main).toBe(6);
    expect(r.match_count_special).toBe(1);
    expect(r.result_bucket).toBe('big_hit');
  });

  it('Lotto 6/49: 6 main + bonus', () => {
    const def649 = LOTTERY_DEFS.lotto_649;
    const winMain = [5, 12, 23, 34, 41, 48];
    const winSpec = [7];
    const r = checkTicket(
      [5, 12, 23, 34, 41, 48],
      [7],
      winMain,
      winSpec,
      def649
    );
    expect(r.match_count_main).toBe(6);
    expect(r.match_count_special).toBe(1);
    expect(r.result_bucket).toBe('big_hit');
  });

  it('Powerball: 5 main no Powerball', () => {
    const defPb = LOTTERY_DEFS.powerball;
    const winMain = [10, 20, 30, 40, 50];
    const winSpec = [15];
    const r = checkTicket(
      [10, 20, 30, 40, 50],
      [99],
      winMain,
      winSpec,
      defPb
    );
    expect(r.match_count_main).toBe(5);
    expect(r.match_count_special).toBe(0);
    expect(r.result_bucket).toBe('big_hit');
  });

  it('Mega Millions: no match', () => {
    const defMm = LOTTERY_DEFS.mega_millions;
    const winMain = [1, 5, 10, 15, 20];
    const winSpec = [10];
    const r = checkTicket(
      [2, 6, 11, 16, 21],
      [5],
      winMain,
      winSpec,
      defMm
    );
    expect(r.match_count_main).toBe(0);
    expect(r.match_count_special).toBe(0);
    expect(r.result_bucket).toBe('no_win');
  });
});
