/**
 * Preload data on app start for instant tab switching.
 * Runs after initDb + InteractionManager (non-blocking).
 */
import { InteractionManager } from 'react-native';
import { getRecords } from '../db/sqlite';
import { getCompassPayload } from '../compass/compassCache';
import type { CheckRecord } from '../db/sqlite';
import type { Draw } from '../types/lottery';

const PRELOAD_LOTTERIES = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'] as const;

// Records cache for Strategy Lab, Insights
let recordsCache: CheckRecord[] | null = null;
let recordsPromise: Promise<CheckRecord[]> | null = null;

export function getPreloadedRecords(): CheckRecord[] | null {
  return recordsCache;
}

/** Call after adding a new check record to refresh cache. */
export function invalidateRecordsCache() {
  recordsCache = null;
  recordsPromise = null;
}

export function getRecordsOrPreload(filter?: { lottery_id?: string }): Promise<CheckRecord[]> {
  const filterFn = (r: CheckRecord[]) =>
    filter?.lottery_id ? r.filter((x) => x.lottery_id === filter.lottery_id) : r;

  if (recordsCache) {
    return Promise.resolve(filterFn(recordsCache));
  }
  if (recordsPromise) {
    return recordsPromise.then(filterFn);
  }
  recordsPromise = getRecords({ limit: 200 });
  recordsPromise.then((r) => {
    recordsCache = r;
  });
  return recordsPromise.then(filterFn);
}

// Draws cache - populated into useDraws memory cache
async function preloadDrawsForLottery(lotteryId: string) {
  const { preloadDraws } = await import('../hooks/useDraws');
  preloadDraws(lotteryId).catch(() => {});
}

// Compass cache - getCompassPayload populates Supabase/local cache
function preloadCompass(lotteryId: string) {
  getCompassPayload(lotteryId).catch(() => {});
}

export function runPreload() {
  InteractionManager.runAfterInteractions(() => {
    // Records (Strategy Lab, Insights)
    getRecords({ limit: 200 })
      .then((r) => {
        recordsCache = r;
      })
      .catch(() => {});

    // Draws for each lottery (Draw History)
    for (const id of PRELOAD_LOTTERIES) {
      preloadDrawsForLottery(id);
    }

    // Compass for default lottery
    preloadCompass('lotto_max');
  });
}
