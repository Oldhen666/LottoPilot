/**
 * Seed sample draws for MVP demo when scraper sources are unavailable.
 * Run manually: npx ts-node scripts/seed-draws.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SEED_DRAWS = [
  { lottery_id: 'lotto_max', draw_date: '2025-02-18', winning_numbers: [3, 12, 21, 28, 35, 42, 49], special_numbers: [7] },
  { lottery_id: 'lotto_649', draw_date: '2025-02-19', winning_numbers: [5, 14, 23, 31, 40, 48], special_numbers: [12] },
];

async function main() {
  for (const d of SEED_DRAWS) {
    const { error } = await supabase.from('draws').upsert(d, { onConflict: 'lottery_id,draw_date' });
    if (error) console.error(d.lottery_id, error);
    else console.log('Seeded', d.lottery_id, d.draw_date);
  }
}

main();
