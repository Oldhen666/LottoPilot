import type { LotteryDef } from '../types/lottery';
import type { CheckResult } from '../types/lottery';

export function checkTicket(
  userMain: number[],
  userSpecial: number[] | undefined,
  winningMain: number[],
  winningSpecial: number[] | undefined,
  def: LotteryDef
): CheckResult {
  const mainSet = new Set(winningMain);
  const specialSet = winningSpecial?.length ? new Set(winningSpecial) : undefined;

  let matchMain = 0;
  for (const n of userMain) {
    if (mainSet.has(n)) matchMain++;
  }

  let matchSpecial = 0;
  if (specialSet) {
    if (userSpecial?.length) {
      for (const n of userSpecial) {
        if (specialSet.has(n)) matchSpecial++;
      }
    } else {
      // Lotto Max: bonus is in the draw; user's 7 main may include it
      for (const n of userMain) {
        if (specialSet.has(n)) matchSpecial++;
      }
    }
  }

  let bucket: 'no_win' | 'small_hit' | 'big_hit' = 'no_win';
  if (matchMain >= def.main_count - 1 || matchSpecial > 0) {
    bucket = matchMain >= def.main_count || (matchMain >= def.main_count - 1 && matchSpecial > 0)
      ? 'big_hit'
      : 'small_hit';
  }

  return {
    match_count_main: matchMain,
    match_count_special: matchSpecial,
    result_bucket: bucket,
    winning_numbers: winningMain,
    winning_special: winningSpecial,
  };
}
