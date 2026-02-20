export type LotteryId = 'lotto_max' | 'lotto_649' | 'powerball' | 'mega_millions';

export interface LotteryDef {
  id: LotteryId;
  name: string;
  country: string;
  draw_frequency: string;
  main_count: number;
  main_min: number;
  main_max: number;
  special_count: number;
  special_min?: number;
  special_max?: number;
  source_url: string;
}

export interface Draw {
  id: string;
  lottery_id: string;
  draw_date: string;
  winning_numbers: number[];
  special_numbers?: number[];
  jackpot_cents?: number;
}

export interface CheckResult {
  match_count_main: number;
  match_count_special: number;
  result_bucket: 'no_win' | 'small_hit' | 'big_hit';
  winning_numbers: number[];
  winning_special?: number[];
}
