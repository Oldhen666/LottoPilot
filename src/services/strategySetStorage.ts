/**
 * Strategy Set storage: exactly one saved strategy per lottery (local).
 * Migrates legacy multi-set (A/B/C…) data by keeping the previously active set (same id) so Pick Book / generated picks stay linked.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { StrategySet } from '../types/strategy';
import {
  getDefaultFeatureWeights,
  snapCommonPenalty01,
  featureWeight01AfterRefineDelta,
  type FeatureId,
} from '../constants/strategyFeatures';
import { isStrategyPlayStyleId } from '../constants/strategyPlayStyle';

const PREFIX = 'lottopilot_strategysets_';
const ACTIVE_KEY = 'lottopilot_strategysets_active_';

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

/** @deprecated Multi-set UI removed; always one strategy per lottery. Kept for compatibility. */
export async function getMaxSets(): Promise<number> {
  return 1;
}

/** Legacy persisted shapes before luckyOnesDigit. */
type LegacyStrategyFields = {
  luckyNumbers?: number[];
  luckyBirthdayDay?: number;
  luckyOnesDigit?: number;
};

function normalizeLuckyOnesDigit(raw: StrategySet & LegacyStrategyFields): number | undefined {
  const d = raw.luckyOnesDigit;
  if (typeof d === 'number' && !Number.isNaN(d)) {
    const r = Math.round(d);
    if (r >= 0 && r <= 9) return r;
  }
  const legacy = raw.luckyNumbers;
  if (Array.isArray(legacy) && legacy.length > 0 && typeof legacy[0] === 'number') {
    return ((legacy[0] % 10) + 10) % 10;
  }
  return undefined;
}

function mapSetDefaults(s: StrategySet): StrategySet {
  const legacy = s as StrategySet & LegacyStrategyFields;
  const luckyOnesDigit = normalizeLuckyOnesDigit(legacy);
  const next: StrategySet = {
    id: s.id,
    name: s.name,
    lotteryId: s.lotteryId,
    featureWeights: s.featureWeights,
    createdAt: s.createdAt,
    luckyBiasStrength: s.luckyBiasStrength ?? 'off',
    autoPilotPlayStyle: isStrategyPlayStyleId((s as StrategySet).autoPilotPlayStyle)
      ? (s as StrategySet).autoPilotPlayStyle
      : 'balanced',
  };
  if (luckyOnesDigit !== undefined) next.luckyOnesDigit = luckyOnesDigit;
  return next;
}

/** Collapse legacy A/B/C… rows to a single persisted strategy (keeps chosen id). */
async function persistSingleStrategy(lotteryId: string, chosen: StrategySet): Promise<StrategySet> {
  const merged: StrategySet = {
    ...mapSetDefaults(chosen),
    name: 'My strategy',
    lotteryId,
  };
  await setItem(storageKey(lotteryId), JSON.stringify([merged]));
  await setActiveSetId(lotteryId, merged.id);
  return merged;
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
      const mapped = arr.map(mapSetDefaults);
      if (mapped.length > 1) {
        const activeId = await getActiveSetId(lotteryId);
        const pick = mapped.find((s) => s.id === activeId) ?? mapped[0];
        const one = await persistSingleStrategy(lotteryId, pick);
        return [one];
      }
      return mapped;
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
  const base = { luckyBiasStrength: 'off' as const };
  return [
    {
      id: `set_${t}`,
      name: 'My strategy',
      lotteryId,
      featureWeights: { ...weights },
      autoPilotPlayStyle: 'balanced',
      ...base,
      createdAt: new Date().toISOString(),
    },
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
  const first = sets[0];
  if (!first) return;
  await setItem(storageKey(lotteryId), JSON.stringify([{ ...mapSetDefaults(first), lotteryId }]));
}

export async function createStrategySet(lotteryId: string): Promise<StrategySet | null> {
  const existing = await getStrategySets(lotteryId);
  return existing[0] ?? null;
}

export async function deleteStrategySet(lotteryId: string, setId: string): Promise<void> {
  const sets = await getStrategySets(lotteryId);
  if (sets.length <= 1) return;
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
    next.featureWeights[d.featureId] = featureWeight01AfterRefineDelta(d.featureId, v, {
      direction: d.direction,
      magnitude: d.magnitude,
    });
  }
  const cpp = next.featureWeights.common_pattern_penalty;
  if (typeof cpp === 'number') {
    next.featureWeights.common_pattern_penalty = snapCommonPenalty01(cpp);
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
