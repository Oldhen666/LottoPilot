/**
 * Strategy Set storage: multiple sets per lottery.
 * Free: 3 sets. Pro/AI Pro: up to 10 sets.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { StrategySet } from '../types/strategy';
import { getDefaultFeatureWeights, type FeatureId } from '../constants/strategyFeatures';
import { getEntitlements } from './entitlements';

const PREFIX = 'lottopilot_strategysets_';
const ACTIVE_KEY = 'lottopilot_strategysets_active_';
const MAX_SETS_FREE = 3;
const MAX_SETS_PRO = 10;

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

function storageKey(lotteryId: string) {
  return `${PREFIX}${lotteryId}`;
}

function activeKey(lotteryId: string) {
  return `${ACTIVE_KEY}${lotteryId}`;
}

export async function getMaxSets(): Promise<number> {
  const ent = await getEntitlements();
  return ent.proUnlocked ? MAX_SETS_PRO : MAX_SETS_FREE;
}

export async function getStrategySets(lotteryId: string): Promise<StrategySet[]> {
  const raw = await getItem(storageKey(lotteryId));
  if (!raw) {
    const defaults = createDefaultSets(lotteryId);
    await setItem(storageKey(lotteryId), JSON.stringify(defaults));
    return defaults;
  }
  try {
    const arr = JSON.parse(raw) as StrategySet[];
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map((s) => ({
        ...s,
        luckyNumbers: s.luckyNumbers ?? [],
        luckyBiasStrength: s.luckyBiasStrength ?? 'off',
      }));
    }
  } catch {
    /* */
  }
  const defaults = createDefaultSets(lotteryId);
  await setItem(storageKey(lotteryId), JSON.stringify(defaults));
  return defaults;
}

function createDefaultSets(lotteryId: string): StrategySet[] {
  const t = Date.now();
  const weights = getDefaultFeatureWeights();
  const base = { luckyNumbers: [], luckyBiasStrength: 'off' as const };
  return [
    { id: `set_${t}_1`, name: 'Set A', lotteryId, featureWeights: { ...weights }, ...base, createdAt: new Date().toISOString() },
    { id: `set_${t}_2`, name: 'Set B', lotteryId, featureWeights: { ...weights }, ...base, createdAt: new Date().toISOString() },
    { id: `set_${t}_3`, name: 'Set C', lotteryId, featureWeights: { ...weights }, ...base, createdAt: new Date().toISOString() },
  ];
}

export async function getActiveSetId(lotteryId: string): Promise<string | null> {
  return getItem(activeKey(lotteryId));
}

export async function setActiveSetId(lotteryId: string, setId: string): Promise<void> {
  await setItem(activeKey(lotteryId), setId);
}

export async function getActiveStrategySet(lotteryId: string): Promise<StrategySet | null> {
  const sets = await getStrategySets(lotteryId);
  const activeId = await getActiveSetId(lotteryId);
  if (activeId) {
    const found = sets.find((s) => s.id === activeId);
    if (found) return found;
  }
  return sets[0] ?? null;
}

export async function saveStrategySets(lotteryId: string, sets: StrategySet[]): Promise<void> {
  const max = await getMaxSets();
  const trimmed = sets.slice(0, max);
  await setItem(storageKey(lotteryId), JSON.stringify(trimmed));
}

export async function createStrategySet(lotteryId: string): Promise<StrategySet | null> {
  const sets = await getStrategySets(lotteryId);
  const max = await getMaxSets();
  if (sets.length >= max) return null;
  const weights = getDefaultFeatureWeights();
  const newSet: StrategySet = {
    id: `set_${Date.now()}`,
    name: `Set ${String.fromCharCode(65 + sets.length)}`,
    lotteryId,
    featureWeights: { ...weights },
    luckyNumbers: [],
    luckyBiasStrength: 'off',
    createdAt: new Date().toISOString(),
  };
  const updated = [...sets, newSet];
  await saveStrategySets(lotteryId, updated);
  return newSet;
}

export async function deleteStrategySet(lotteryId: string, setId: string): Promise<void> {
  const sets = await getStrategySets(lotteryId);
  const filtered = sets.filter((s) => s.id !== setId);
  if (filtered.length < 1) return;
  await saveStrategySets(lotteryId, filtered);
  const activeId = await getActiveSetId(lotteryId);
  if (activeId === setId) {
    await setActiveSetId(lotteryId, filtered[0].id);
  }
}

export async function updateStrategySet(set: StrategySet): Promise<void> {
  const sets = await getStrategySets(set.lotteryId);
  const idx = sets.findIndex((s) => s.id === set.id);
  if (idx < 0) return;
  sets[idx] = { ...set };
  await saveStrategySets(set.lotteryId, sets);
}

export async function applyFeatureAdjustment(
  set: StrategySet,
  deltas: { featureId: FeatureId; direction: 'increase' | 'decrease'; magnitude: number }[]
): Promise<StrategySet> {
  const next = { ...set, featureWeights: { ...set.featureWeights } };
  for (const d of deltas) {
    const v = next.featureWeights[d.featureId];
    if (typeof v !== 'number') continue;
    const delta = d.direction === 'increase' ? d.magnitude : -d.magnitude;
    next.featureWeights[d.featureId] = Math.max(0, Math.min(1, v + delta));
  }
  await updateStrategySet(next);
  return next;
}

export function coarseAdjust(
  current: number,
  direction: 'more' | 'less',
  step = 0.01
): number {
  const delta = direction === 'more' ? step : -step;
  return Math.max(0, Math.min(1, current + delta));
}
