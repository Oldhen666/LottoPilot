/**
 * Draw date validation for lotteries with fixed draw days.
 * Powerball: Mon/Wed/Sat. Mega Millions: Tue/Fri. etc.
 */
import { LOTTERY_DRAW_DAYS } from '../constants/lotteryDrawDays';
import type { LotteryId } from '../types/lottery';

/** Check if a date (YYYY-MM-DD) is a valid draw day for the lottery */
export function isValidDrawDate(dateISO: string, lotteryId: LotteryId): boolean {
  const allowed = LOTTERY_DRAW_DAYS[lotteryId];
  if (!allowed?.length) return true;
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const wd = date.getUTCDay();
  return allowed.includes(wd);
}

/** Get weekday name for display */
export function getWeekdayName(dateISO: string): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = new Date(dateISO + 'T12:00:00Z');
  return names[d.getUTCDay()];
}
