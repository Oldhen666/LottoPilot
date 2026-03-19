/**
 * Update Compass snapshots in Supabase.
 * Run after scrape: npm run scrape && npm run compass:update
 * Or: npm run compass:update (uses existing draws in Supabase)
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { computeCompass } from '../src/compass/compassModel';
import { LOTTERY_DEFS } from '../src/constants/lotteries';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const DRAWS_SELECT = 'draw_date, winning_numbers';
const COMPASS_LOTTERIES = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'] as const;

export async function runCompassUpdate() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  for (const gameCode of COMPASS_LOTTERIES) {
    const def = LOTTERY_DEFS[gameCode];
    if (!def) continue;

    const { data: draws, error } = await supabase
      .from('draws')
      .select(DRAWS_SELECT)
      .eq('lottery_id', gameCode)
      .order('draw_date', { ascending: false })
      .limit(500);

    if (error) {
      console.error(`${gameCode} fetch error:`, error);
      continue;
    }

    const records = (draws || []).map((d: { draw_date: string; winning_numbers: number[] }) => ({
      draw_date: d.draw_date,
      winning_numbers: Array.isArray(d.winning_numbers) ? d.winning_numbers : [],
    }));

    const payload = computeCompass(
      records,
      gameCode,
      def.main_count,
      def.main_max
    );

    if (!payload) {
      console.log(`${gameCode}: insufficient draws (need >=100), got ${records.length}`);
      continue;
    }

    const { error: upsertErr } = await supabase.from('compass_snapshots').upsert(
      {
        game_code: gameCode,
        payload_json: payload,
        long_window_days: payload.meta.longWindowDays,
        short_window_days: payload.meta.shortWindowDays,
        long_draws: payload.meta.longDraws,
        short_draws: payload.meta.shortDraws,
        computed_at: payload.meta.computedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'game_code' }
    );

    if (upsertErr) {
      console.error(`${gameCode} upsert error:`, upsertErr);
    } else {
      console.log(`${gameCode}: updated (${payload.meta.longDraws} long, ${payload.meta.shortDraws} short draws)`);
    }
  }

  console.log('Compass update complete');
}

if (require.main === module) {
  runCompassUpdate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
