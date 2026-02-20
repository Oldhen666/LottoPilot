import { useState, useEffect } from 'react';
import { fetchDraws, fetchLatestDraw } from '../services/supabase';
import type { Draw } from '../types/lottery';

export function useDraws(lotteryId: string | null) {
  const [draws, setDraws] = useState<Draw[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lotteryId) {
      setDraws([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchDraws(lotteryId)
      .then(setDraws)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [lotteryId]);

  return { draws, loading, error };
}

export function useLatestDraw(lotteryId: string | null) {
  const [draw, setDraw] = useState<Draw | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lotteryId) {
      setDraw(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchLatestDraw(lotteryId)
      .then(setDraw)
      .finally(() => setLoading(false));
  }, [lotteryId]);

  return { draw, loading };
}
