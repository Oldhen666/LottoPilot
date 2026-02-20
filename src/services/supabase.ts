import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Draw } from '../types/lottery';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let supabase: SupabaseClient | null = null;
if (isConfigured) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export async function fetchDraws(lotteryId: string, limit = 20): Promise<Draw[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('draws')
    .select('id, lottery_id, draw_date, winning_numbers, special_numbers, jackpot_cents')
    .eq('lottery_id', lotteryId)
    .order('draw_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as Draw[];
}

export async function fetchLatestDraw(lotteryId: string): Promise<Draw | null> {
  const draws = await fetchDraws(lotteryId, 1);
  return draws[0] || null;
}
