/**
 * Test Supabase draws fetch - run outside the app to verify API works.
 * Usage: npx ts-node -r dotenv/config scripts/test-supabase-draws.ts
 * Or: node --env-file=.env scripts/test-supabase-draws.js (if compiled)
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  console.log('Supabase URL:', url ? `${url.slice(0, 30)}...` : 'NOT SET');
  console.log('Supabase Key:', key ? `${key.slice(0, 20)}...` : 'NOT SET');
  if (!url || !key) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('draws')
    .select('id, lottery_id, draw_date, winning_numbers')
    .eq('lottery_id', 'lotto_max')
    .order('draw_date', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Supabase error:', error.message, error.code);
    process.exit(1);
  }
  console.log('Fetched', data?.length ?? 0, 'draws for lotto_max');
  if (data?.length) {
    console.log('Latest:', data[0]?.draw_date, data[0]?.winning_numbers);
  }
}

main();
