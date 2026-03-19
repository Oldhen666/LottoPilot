/**
 * Lottery draw day mapping (weekday 0=Sun, 1=Mon, ..., 6=Sat).
 * Used to boost confidence when parsed date matches expected draw days.
 */
import type { LotteryId } from '../types/lottery';

export const LOTTERY_DRAW_DAYS: Record<LotteryId, number[]> = {
  lotto_max: [2, 5],      // Tue, Fri
  lotto_649: [3, 6],      // Wed, Sat
  powerball: [1, 3, 6],   // Mon, Wed, Sat
  mega_millions: [2, 5],  // Tue, Fri
};
