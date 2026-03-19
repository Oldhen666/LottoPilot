/**
 * Add a missing draw that the scraper didn't fetch.
 * Run: npx ts-node --project scripts/tsconfig.json scripts/add-missing-draw.ts
 *
 * Example: Add Lotto Max 2025-09-05 (missing from WCLC PDF)
 * Source: https://www.lottoresult.ca/lotto-max-results-sep-5-2025
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY);

// Manually curated missing draws (from WCLC/lottoresult.ca when PDF skips them)
const MISSING_DRAWS = [
  {
    lottery_id: 'lotto_max',
    draw_date: '2025-09-05',
    winning_numbers: [4, 16, 20, 30, 34, 46, 50],
    special_numbers: [40],
  },
];

async function main() {
  for (const d of MISSING_DRAWS) {
    const { error } = await supabase.from('draws').upsert(d, { onConflict: 'lottery_id,draw_date' });
    if (error) {
      console.error('Error:', d.draw_date, error);
    } else {
      console.log('Added', d.lottery_id, d.draw_date);
    }
  }
}

main();
