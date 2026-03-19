/**
 * Get prize tier icon for Match Summary based on win rank.
 * - 1st (Jackpot): Crown
 * - 2nd: Diamond
 * - 3rd: Gift
 * - Other wins: Celebration
 */
import { BUNDLED_TIERS } from '../constants/bundledPrizeTiers';

export const PRIZE_ICONS = {
  JACKPOT: '👑',
  SECOND: '💎',
  THIRD: '🎁',
  OTHER: '🎉',
} as const;

export function getPrizeTierIcon(
  lotteryId: string,
  matchMain: number,
  matchSpecial: number
): string | null {
  const tiers = BUNDLED_TIERS[lotteryId];
  if (!tiers) return null;
  const tier = tiers.find(
    (t) => t.match_main === matchMain && t.match_special === matchSpecial
  );
  if (!tier) return null;
  const order = tier.sort_order;
  if (order === 0) return PRIZE_ICONS.JACKPOT;
  if (order === 1) return PRIZE_ICONS.SECOND;
  if (order === 2) return PRIZE_ICONS.THIRD;
  return PRIZE_ICONS.OTHER;
}
