#!/usr/bin/env tsx
/**
 * Daily lottery results update script.
 * Run: node scripts/run-update.ts (or: npx tsx scripts/run-update.ts)
 * Schedule: cron 0 0 * * * (daily 00:00) or Windows Task Scheduler
 * Timezone: TZ=America/Edmonton (or system default)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { createClient } from '@supabase/supabase-js';
import { fetchers } from '../src/fetchers';
import type { ParsedDraw } from '../src/fetchers/types';

const JOB_NAME = 'daily_results_update';
const RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 10000;

function getNow(): Date {
  const tz = process.env.TZ || 'America/Edmonton';
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 0; i < RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e as Error;
      if (i < RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * Math.pow(2, i));
      }
    }
  }
  throw lastErr;
}

async function run() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const now = getNow();
  const startedAt = new Date().toISOString();

  const summary = { updated: [] as string[], no_draw: [] as string[], errors: [] as string[] };
  const runId = crypto.randomUUID();

  const { data: runRow, error: runInsertErr } = await supabase
    .from('job_runs')
    .insert({
      id: runId,
      job_name: JOB_NAME,
      started_at: startedAt,
      finished_at: null,
      status: 'success',
      summary_json: summary,
    })
    .select('id')
    .single();

  if (runInsertErr) {
    console.error('Failed to insert job_runs:', runInsertErr);
    process.exit(1);
  }

  const insertError = async (lotteryCode: string, stage: string, message: string, stack?: string, context?: object) => {
    await supabase.from('job_errors').insert({
      run_id: runId,
      lottery_code: lotteryCode,
      stage,
      message,
      error_stack: stack ?? null,
      context_json: context ?? null,
    });
  };

  for (const fetcher of fetchers) {
    const drawDates = fetcher.getExpectedDrawDates(now);
    if (drawDates.length === 0) {
      summary.no_draw.push(fetcher.code);
      continue;
    }

    for (const drawDate of drawDates) {
      try {
        const raw = await withRetry(() =>
          Promise.race([
            fetcher.fetch(drawDate),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Fetch timeout')), FETCH_TIMEOUT_MS)),
          ]) as Promise<unknown>
        );
        const parsed = fetcher.parse(raw);
        fetcher.validate(parsed);

        const { error: upsertErr } = await supabase.from('lottery_draws').upsert(
          {
            lottery_code: fetcher.code,
            draw_date: drawDate,
            draw_id: parsed.drawId ?? null,
            numbers_json: parsed.numbers,
            source: 'mock',
            fetched_at: new Date().toISOString(),
            status: parsed.status,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'lottery_code,draw_date' }
        );

        if (upsertErr) throw upsertErr;

        const { data: state } = await supabase.from('lottery_state').select('latest_draw_date').eq('lottery_code', fetcher.code).single();
        const prevDate = state?.latest_draw_date;
        const shouldUpdate = !prevDate || drawDate > prevDate;

        if (shouldUpdate) {
          await supabase.from('lottery_state').upsert(
            {
              lottery_code: fetcher.code,
              latest_draw_date: drawDate,
              latest_numbers_json: parsed.numbers,
              latest_status: parsed.status,
              last_success_at: new Date().toISOString(),
              last_attempt_at: new Date().toISOString(),
              consecutive_failures: 0,
              last_error_id: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'lottery_code' }
          );
        }

        summary.updated.push(`${fetcher.code}:${drawDate}`);
      } catch (e) {
        const err = e as Error;
        summary.errors.push(fetcher.code);
        await insertError(fetcher.code, 'fetch', err.message, err.stack, { drawDate });
      }
    }
  }

  const status = summary.errors.length > 0 ? (summary.updated.length > 0 ? 'partial' : 'failed') : 'success';
  await supabase
    .from('job_runs')
    .update({ finished_at: new Date().toISOString(), status, summary_json: summary })
    .eq('id', runId);

  console.log(JSON.stringify({ status, summary }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
