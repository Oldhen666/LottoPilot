/**
 * Store generated picks by draw date. Persists across sessions.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { CandidatePick } from '../utils/localAnalysis';

const PREFIX = 'lottopilot_generated_picks_';

const isWeb = Platform.OS === 'web';

async function getItem(key: string): Promise<string | null> {
  if (isWeb && typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb && typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export interface StoredPicksByDate {
  [drawDate: string]: CandidatePick[];
}

function storageKey(lotteryId: string) {
  return `${PREFIX}${lotteryId}`;
}

export async function getGeneratedPicks(lotteryId: string): Promise<StoredPicksByDate> {
  const raw = await getItem(storageKey(lotteryId));
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as StoredPicksByDate;
    if (obj && typeof obj === 'object') return obj;
  } catch {
    /* */
  }
  return {};
}

/** Replace picks for the given date (one set per day). */
export async function setGeneratedPicksForDate(
  lotteryId: string,
  drawDate: string,
  picks: CandidatePick[]
): Promise<void> {
  const current = await getGeneratedPicks(lotteryId);
  current[drawDate] = picks;
  await setItem(storageKey(lotteryId), JSON.stringify(current));
}

export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}
