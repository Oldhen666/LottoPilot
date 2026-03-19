import { useState, useEffect } from 'react';
import { fetchDraws, fetchLatestDraw, isAuthError, isSupabaseConfigured, resetSupabaseAndClearStorage } from '../services/supabase';
import { getDrawsFromCache, upsertDrawsCache } from '../db/drawsCache';
import type { Draw } from '../types/lottery';

const DRAWS_CACHE_TTL_MS = 5 * 60 * 1000;
const memoryCache: { key: string; draws: Draw[]; ts: number }[] = [];

function getCachedDraws(lotteryId: string): Draw[] | null {
  const entry = memoryCache.find((c) => c.key === lotteryId);
  if (!entry || Date.now() - entry.ts > DRAWS_CACHE_TTL_MS) return null;
  return entry.draws;
}

function setCachedDraws(lotteryId: string, draws: Draw[]) {
  const idx = memoryCache.findIndex((c) => c.key === lotteryId);
  if (idx >= 0) memoryCache.splice(idx, 1);
  memoryCache.push({ key: lotteryId, draws, ts: Date.now() });
}

/** Invalidate cache so next fetch goes to Supabase. Call when data seems stale. */
export function invalidateDrawsCache(lotteryId?: string) {
  if (lotteryId) {
    const idx = memoryCache.findIndex((c) => c.key === lotteryId);
    if (idx >= 0) memoryCache.splice(idx, 1);
  } else {
    memoryCache.length = 0;
  }
}

/** For Lotto Max/649: if winning_numbers has 8 (7 main + bonus) but no special_numbers, split. */
function postProcessDrawFromCache(d: { draw_date: string; winning_numbers: number[]; special_numbers?: number[] }, lotteryId: string): Draw {
  const mainCount = { lotto_max: 7, lotto_649: 6 }[lotteryId];
  const needSplit = mainCount && !d.special_numbers?.length && d.winning_numbers.length === mainCount + 1;
  const winning_numbers = needSplit ? d.winning_numbers.slice(0, mainCount) : d.winning_numbers;
  const special_numbers = needSplit ? d.winning_numbers.slice(mainCount, mainCount + 1) : d.special_numbers;
  return {
    id: d.draw_date,
    lottery_id: lotteryId,
    draw_date: d.draw_date,
    winning_numbers,
    special_numbers: special_numbers?.length ? special_numbers : undefined,
    jackpot_cents: undefined,
  };
}

/** Preload draws into memory cache (for instant Draw History). */
export async function preloadDraws(lotteryId: string): Promise<void> {
  if (getCachedDraws(lotteryId)) return;
  try {
    const local = await getDrawsFromCache(lotteryId, 100);
    if (local.length >= 1) {
      const asDraws: Draw[] = local.map((d) => postProcessDrawFromCache(d, lotteryId));
      setCachedDraws(lotteryId, asDraws);
      return;
    }
    const data = await fetchDraws(lotteryId, 100);
    setCachedDraws(lotteryId, data);
  } catch (e) {
    if (isAuthError(e)) await resetSupabaseAndClearStorage();
  }
}

export function useDraws(lotteryId: string | null, refetchTrigger?: number) {
  const [draws, setDraws] = useState<Draw[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lotteryId) {
      setDraws([]);
      setLoading(false);
      return;
    }
    const forceRefetch = (refetchTrigger ?? 0) > 0;
    if (forceRefetch) {
      invalidateDrawsCache(lotteryId);
    }
    const cached = getCachedDraws(lotteryId);
    if (cached?.length && !forceRefetch) {
      setDraws(cached);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    if (forceRefetch) {
      fetchDraws(lotteryId, 100)
        .then((data) => {
          if (data?.length) {
            setCachedDraws(lotteryId, data);
            setDraws(data);
            upsertDrawsCache(lotteryId, data.map((d) => ({ draw_date: d.draw_date, winning_numbers: d.winning_numbers, special_numbers: d.special_numbers }))).catch(() => {});
          } else {
            setDraws([]);
          }
        })
        .catch(async (e) => {
          if (isAuthError(e)) await resetSupabaseAndClearStorage();
          try {
            const retry = await fetchDraws(lotteryId, 100);
            if (retry?.length) {
              setCachedDraws(lotteryId, retry);
              setDraws(retry);
              upsertDrawsCache(lotteryId, retry.map((d) => ({ draw_date: d.draw_date, winning_numbers: d.winning_numbers, special_numbers: d.special_numbers }))).catch(() => {});
            } else {
              setDraws([]);
            }
          } catch (err) {
            const msg = (err as Error)?.message || String(err);
            if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
              setError('Unable to connect. Check internet and Supabase config (.env). Restart app after changing .env.');
            } else {
              setError(msg);
            }
          }
        })
        .finally(() => setLoading(false));
      return;
    }
    getDrawsFromCache(lotteryId, 100)
      .then((local) => {
        const asDraws: Draw[] = local.map((d) => postProcessDrawFromCache(d, lotteryId));
        if (local.length >= 1) {
          setCachedDraws(lotteryId, asDraws);
          setDraws(asDraws);
          if (local.length < 20) {
            fetchDraws(lotteryId, 100)
              .then((fresh) => {
                if (fresh?.length) {
                  setCachedDraws(lotteryId, fresh);
                  setDraws(fresh);
                  upsertDrawsCache(lotteryId, fresh.map((d) => ({ draw_date: d.draw_date, winning_numbers: d.winning_numbers, special_numbers: d.special_numbers }))).catch(() => {});
                }
              })
              .catch(() => {});
          }
          return null;
        }
        return fetchDraws(lotteryId, 100).then((data) => {
          if (data?.length) {
            setCachedDraws(lotteryId, data);
            setDraws(data);
            upsertDrawsCache(lotteryId, data.map((d) => ({ draw_date: d.draw_date, winning_numbers: d.winning_numbers, special_numbers: d.special_numbers }))).catch(() => {});
          } else if (asDraws.length > 0) {
            setCachedDraws(lotteryId, asDraws);
            setDraws(asDraws);
          }
          return data;
        });
      })
      .catch(() => fetchDraws(lotteryId, 100))
      .then((data) => {
        if (data?.length) {
          setCachedDraws(lotteryId, data);
          setDraws(data);
          upsertDrawsCache(lotteryId, data.map((d) => ({ draw_date: d.draw_date, winning_numbers: d.winning_numbers, special_numbers: d.special_numbers }))).catch(() => {});
        }
      })
      .catch(async (e) => {
        const msg = e?.message || String(e);
        if (isAuthError(e)) await resetSupabaseAndClearStorage();
        try {
          const retry = await fetchDraws(lotteryId, 100);
          if (retry?.length) {
            setCachedDraws(lotteryId, retry);
            setDraws(retry);
            upsertDrawsCache(lotteryId, retry.map((d) => ({ draw_date: d.draw_date, winning_numbers: d.winning_numbers, special_numbers: d.special_numbers }))).catch(() => {});
            setError(null);
            return;
          }
        } catch {
          /* ignore */
        }
        try {
          const local = await getDrawsFromCache(lotteryId, 100);
          if (local.length > 0) {
            const asDraws: Draw[] = local.map((d) => postProcessDrawFromCache(d, lotteryId));
            setCachedDraws(lotteryId, asDraws);
            setDraws(asDraws);
            setError(null);
            return;
          }
        } catch {
          /* ignore */
        }
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          setError('Unable to connect. Check internet and Supabase config (.env). Restart app after changing .env.');
        } else {
          setError(msg);
        }
      })
      .finally(() => setLoading(false));
  }, [lotteryId, refetchTrigger ?? 0]);

  return { draws, loading, error };
}

function toDraw(lotteryId: string, raw: { draw_date: string; winning_numbers: number[] }): Draw {
  return {
    id: raw.draw_date,
    lottery_id: lotteryId,
    draw_date: raw.draw_date,
    winning_numbers: raw.winning_numbers,
    special_numbers: [],
  };
}

export function useLatestDraw(lotteryId: string | null, refetchTrigger?: number) {
  const [draw, setDraw] = useState<Draw | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lotteryId) {
      setDraw(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (!isSupabaseConfigured()) {
      setDraw(null);
      setLoading(false);
      setError('Supabase not configured. Check .env (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY). Restart dev server after editing .env.');
      return;
    }
    let cancelled = false;
    setError(null);
    const forceRefetch = (refetchTrigger ?? 0) > 0;
    if (forceRefetch) invalidateDrawsCache(lotteryId);

    const tryCacheFirst = async () => {
      try {
        if (!forceRefetch) {
          const cached = getCachedDraws(lotteryId);
          if (cached?.length) {
            if (!cancelled) {
              setDraw(cached[0]);
              setError(null);
            }
            setLoading(false);
            return;
          }
          const local = await getDrawsFromCache(lotteryId, 1);
          if (cancelled) return;
          if (local.length) {
            setDraw(toDraw(lotteryId, local[0]));
            setError(null);
            setLoading(false);
            return;
          }
        }
      } catch {
        /* fallback to Supabase */
      }
      if (__DEV__) console.log('[useLatestDraw] fetchLatestDraw start', lotteryId);
      fetchLatestDraw(lotteryId)
        .then((d) => {
          if (__DEV__) console.log('[useLatestDraw] fetchLatestDraw ok', !!d);
          if (!cancelled) {
            if (d) {
              setDraw(d);
              setError(null);
            } else {
              setError(null);
            }
          }
        })
        .catch((e) => {
          if (__DEV__) console.log('[useLatestDraw] fetchLatestDraw error', e?.message || e);
          if (cancelled) return;
          if (isAuthError(e)) resetSupabaseAndClearStorage();
          const msg = e?.message || String(e);
          const isNetworkErr = /fetch|timeout|network|TypeError/i.test(msg);
          setError(isNetworkErr
            ? 'Network request failed. Check: 1) Supabase project not paused 2) Internet/VPN 3) Try mobile data'
            : msg);
        })
        .finally(() => {
          if (__DEV__) console.log('[useLatestDraw] fetchLatestDraw finally, loading=false');
          if (!cancelled) setLoading(false);
        });
    };

    setLoading(true);
    tryCacheFirst();
    return () => {
      cancelled = true;
    };
  }, [lotteryId, refetchTrigger ?? 0]);

  return { draw, loading, error };
}
