/**
 * Bundled prize tiers used when Supabase is unavailable or prize rules are not loaded.
 * Based on standard CA (Lotto Max/649) and US (Powerball/Mega Millions) rules.
 */
import type { PrizeTier } from '../types/jurisdiction';

const makeTier = (
  matchMain: number,
  matchSpecial: number,
  prizeType: 'FIXED' | 'PARI_MUTUEL' | 'FREE_PLAY',
  prizeAmount: number | null,
  prizeCurrency: 'CAD' | 'USD',
  sortOrder: number
): PrizeTier => ({
  id: `bundled-${sortOrder}`,
  rule_set_id: 'bundled',
  tier_name: '',
  match_main: matchMain,
  match_special: matchSpecial,
  match_bonus: null,
  prize_type: prizeType,
  prize_amount: prizeAmount,
  prize_currency: prizeCurrency,
  multiplier_applicable: false,
  min_prize: null,
  max_prize: null,
  sort_order: sortOrder,
});

export const BUNDLED_TIERS: Record<string, PrizeTier[]> = {
  lotto_max: [
    makeTier(7, 1, 'PARI_MUTUEL', null, 'CAD', 0),
    makeTier(7, 0, 'PARI_MUTUEL', null, 'CAD', 1),
    makeTier(6, 1, 'PARI_MUTUEL', null, 'CAD', 2),
    makeTier(6, 0, 'PARI_MUTUEL', null, 'CAD', 3), // 6/7: Share of 2.5% pool (avg ~$5,266)
    makeTier(5, 1, 'PARI_MUTUEL', null, 'CAD', 4), // 5/7+: Share of 1.5% pool
    makeTier(5, 0, 'PARI_MUTUEL', null, 'CAD', 5), // 5/7: Share of 3.5% pool
    makeTier(4, 1, 'PARI_MUTUEL', null, 'CAD', 6), // 4/7+: Share of 2.75% pool
    makeTier(4, 0, 'FIXED', 20, 'CAD', 7), // 4/7: Fixed $20
    makeTier(3, 1, 'FIXED', 20, 'CAD', 8), // 3/7+: Fixed $20
    makeTier(3, 0, 'FREE_PLAY', null, 'CAD', 9),
  ],
  lotto_649: [
    makeTier(6, 0, 'PARI_MUTUEL', null, 'CAD', 0), // 6/6: Jackpot (79.5% of pool)
    makeTier(5, 1, 'PARI_MUTUEL', null, 'CAD', 1), // 5/6+Bonus: 6% of pool
    makeTier(5, 0, 'PARI_MUTUEL', null, 'CAD', 2), // 5/6: 5% of pool
    makeTier(4, 0, 'PARI_MUTUEL', null, 'CAD', 3), // 4/6: 9.5% of pool
    makeTier(3, 1, 'FIXED', 10, 'CAD', 4), // 3/6 (incl. w/ bonus): $10
    makeTier(3, 0, 'FIXED', 10, 'CAD', 5),
    makeTier(2, 1, 'FIXED', 5, 'CAD', 6), // 2/6+Bonus: $5
    makeTier(2, 0, 'FREE_PLAY', null, 'CAD', 7), // 2/6: Free Play
  ],
  powerball: [
    makeTier(5, 1, 'PARI_MUTUEL', null, 'USD', 0),
    makeTier(5, 0, 'FIXED', 1000000, 'USD', 1),
    makeTier(4, 1, 'FIXED', 50000, 'USD', 2),
    makeTier(4, 0, 'FIXED', 100, 'USD', 3),
    makeTier(3, 1, 'FIXED', 100, 'USD', 4),
    makeTier(3, 0, 'FIXED', 7, 'USD', 5),
    makeTier(2, 1, 'FIXED', 7, 'USD', 6),
    makeTier(1, 1, 'FIXED', 4, 'USD', 7),
    makeTier(0, 1, 'FIXED', 4, 'USD', 8),
  ],
  mega_millions: [
    makeTier(5, 1, 'PARI_MUTUEL', null, 'USD', 0),
    makeTier(5, 0, 'FIXED', 1000000, 'USD', 1),
    makeTier(4, 1, 'FIXED', 10000, 'USD', 2),
    makeTier(4, 0, 'FIXED', 500, 'USD', 3),
    makeTier(3, 1, 'FIXED', 200, 'USD', 4),
    makeTier(3, 0, 'FIXED', 10, 'USD', 5),
    makeTier(2, 1, 'FIXED', 10, 'USD', 6),
    makeTier(1, 1, 'FIXED', 4, 'USD', 7),
    makeTier(0, 1, 'FIXED', 2, 'USD', 8),
  ],
};
