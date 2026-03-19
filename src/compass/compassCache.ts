/**
 * Compass cache: Supabase snapshot first (pre-computed daily), fallback to local compute.
 */
import { fetchCompassSnapshot, fetchDrawsForCompass } from '../services/supabase';
import { getDrawsFromCache, upsertDrawsCache, getCompassCache, setCompassCache } from '../db/sqlite';
import { computeCompass } from './compassModel';
import type { CompassPayload, CompassConfig } from './types';
import { LOTTERY_DEFS } from '../constants/lotteries';

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DRAWS_LIMIT = 400;

export interface GetCompassResult {
  payload: CompassPayload | null;
  source: 'cache' | 'computed';
  insufficientHistory: boolean;
}

/** Get draws: local cache first (fast), then optionally sync from Supabase in background. */
export async function getDrawsForCompass(lotteryId: string): Promise<{ draw_date: string; winning_numbers: number[] }[]> {
  const local = await getDrawsFromCache(lotteryId, DRAWS_LIMIT);
  if (local.length >= 100) {
    void syncDrawsFromSupabase(lotteryId);
    return local;
  }
  try {
    const draws = await fetchDrawsForCompass(lotteryId, DRAWS_LIMIT);
    const records = draws.map((d) => ({
      draw_date: d.draw_date,
      winning_numbers: Array.isArray(d.winning_numbers) ? d.winning_numbers : [],
      special_numbers: d.special_numbers,
    }));
    if (records.length > 0) {
      await upsertDrawsCache(lotteryId, records);
    }
    return records;
  } catch {
    return local;
  }
}

async function syncDrawsFromSupabase(lotteryId: string): Promise<void> {
  try {
    const draws = await fetchDrawsForCompass(lotteryId, DRAWS_LIMIT);
    const records = draws.map((d) => ({
      draw_date: d.draw_date,
      winning_numbers: Array.isArray(d.winning_numbers) ? d.winning_numbers : [],
      special_numbers: d.special_numbers,
    }));
    if (records.length > 0) {
      await upsertDrawsCache(lotteryId, records);
    }
  } catch {
    /* ignore */
  }
}

/** Get Compass payload: Supabase snapshot first, else local cache, else compute. */
export async function getCompassPayload(
  gameCode: string,
  config?: Partial<CompassConfig>
): Promise<GetCompassResult> {
  const def = LOTTERY_DEFS[gameCode];
  if (!def) return { payload: null, source: 'cache', insufficientHistory: false };

  try {
    const snapshot = await fetchCompassSnapshot(gameCode);
    if (snapshot?.payload_json) {
      return {
        payload: snapshot.payload_json as CompassPayload,
        source: 'cache',
        insufficientHistory: false,
      };
    }
  } catch {
    /* fallback to local */
  }

  const localCached = await getCompassCache(gameCode);
  const now = Date.now();
  const cacheAge = localCached ? now - new Date(localCached.computedAt).getTime() : Infinity;
  if (localCached && cacheAge < CACHE_MAX_AGE_MS) {
    return {
      payload: localCached.payload as CompassPayload,
      source: 'cache',
      insufficientHistory: false,
    };
  }

  const draws = await getDrawsForCompass(gameCode);
  const records = draws.map((d) => ({ draw_date: d.draw_date, winning_numbers: d.winning_numbers }));

  const payload = computeCompass(
    records,
    gameCode,
    def.main_count,
    def.main_max,
    config
  );

  if (payload) {
    await setCompassCache(
      gameCode,
      config?.longWindowDays ?? 3650,
      config?.shortWindowDays ?? 180,
      payload
    );
  }

  return {
    payload,
    source: 'computed',
    insufficientHistory: draws.length < (config?.minDrawsRequired ?? 100),
  };
}

/** Force recompute (e.g. after draws update) */
export async function invalidateCompassCache(gameCode: string): Promise<void> {
  const { deleteCompassCache } = await import('../db/sqlite');
  await deleteCompassCache(gameCode);
}
