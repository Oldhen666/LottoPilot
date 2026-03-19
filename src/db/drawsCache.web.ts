/**
 * Web: no SQLite (expo-sqlite WASM issues). Draws come from Supabase only.
 */
export async function getDrawsFromCache(
  _lotteryId: string,
  _limit = 500
): Promise<{ draw_date: string; winning_numbers: number[]; special_numbers?: number[] }[]> {
  return [];
}

export async function upsertDrawsCache(
  _lotteryId: string,
  _draws: { draw_date: string; winning_numbers: number[]; special_numbers?: number[] }[]
): Promise<void> {
  /* no-op on web */
}
