/**
 * Seed ENCORE numbers for testing when scraper hasn't run or for manual verification.
 * OLG ENCORE: 7-digit number, same draw date as Lotto Max / Lotto 6/49.
 * Run: npx ts-node --project scripts/tsconfig.json scripts/seed-encore-draw.ts
 *
 * Example from lottoresult.ca Dec 5, 2025: Ontario Encore: 8850544
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

// Manual ENCORE seeds: { lottery_id, draw_date, encore_number }
// Source: lottoresult.ca "Ontario Encore" or OLG official
const ENCORE_SEEDS = [
  { lottery_id: 'lotto_max', draw_date: '2025-12-05', encore_number: '8850544' },
  { lottery_id: 'lotto_649', draw_date: '2025-12-06', encore_number: '9541839' },
  // Add more for testing - ensure draw exists first (run npm run scrape or seed-draws)
];

async function main() {
  for (const s of ENCORE_SEEDS) {
    const { error } = await supabase
      .from('draws')
      .update({ encore_number: s.encore_number })
      .eq('lottery_id', s.lottery_id)
      .eq('draw_date', s.draw_date);

    if (error) {
      console.error('Error:', s.lottery_id, s.draw_date, error);
    } else {
      console.log('Seeded ENCORE', s.lottery_id, s.draw_date, '=', s.encore_number);
    }
  }
}

main();
