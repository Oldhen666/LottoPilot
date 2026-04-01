/**
 * Store generated picks by draw date, per lottery + Strategy Set.
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

async function deleteItem(key: string): Promise<void> {
  if (isWeb && typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export interface StoredPicksByDate {
  [drawDate: string]: CandidatePick[];
}

/** Per lottery + strategy set */
function storageKey(lotteryId: string, strategySetId: string) {
  return `${PREFIX}${lotteryId}__${strategySetId}`;
}

/** Legacy: only lottery (pre–per-set storage) */
function legacyStorageKey(lotteryId: string) {
  return `${PREFIX}${lotteryId}`;
}

export async function getGeneratedPicks(lotteryId: string, strategySetId: string): Promise<StoredPicksByDate> {
  const key = storageKey(lotteryId, strategySetId);
  const raw = await getItem(key);
  if (raw) {
    try {
      const obj = JSON.parse(raw) as StoredPicksByDate;
      if (obj && typeof obj === 'object') return obj;
    } catch {
      /* */
    }
  }
  const legacy = await getItem(legacyStorageKey(lotteryId));
  if (legacy) {
    try {
      const obj = JSON.parse(legacy) as StoredPicksByDate;
      if (obj && typeof obj === 'object') {
        await setItem(key, legacy);
        await deleteItem(legacyStorageKey(lotteryId));
        return obj;
      }
    } catch {
      /* */
    }
  }
  return {};
}

export async function setGeneratedPicksForDate(
  lotteryId: string,
  strategySetId: string,
  drawDate: string,
  picks: CandidatePick[]
): Promise<void> {
  const current = await getGeneratedPicks(lotteryId, strategySetId);
  current[drawDate] = picks;
  await setItem(storageKey(lotteryId, strategySetId), JSON.stringify(current));
}

export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}
