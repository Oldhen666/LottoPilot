/**
 * Strategy profile storage: versioned profiles per lottery.
 * Uses SecureStore. Supports rollback to previous versions.
 */
import * as SecureStore from 'expo-secure-store';
import type { StrategyProfile } from '../types/strategy';
import type { AnalysisWeights } from '../utils/localAnalysis';

const PREFIX = 'lottopilot_strategy_';
const HISTORY_PREFIX = 'lottopilot_strategy_history_';
const DEFAULT_WEIGHTS: AnalysisWeights = {
  hotWeight: 0.4,
  coldWeight: 0.3,
  oddEvenRatio: 0.5,
  consecutivePenalty: 0.5,
};

function key(lotteryId: string) {
  return `${PREFIX}${lotteryId}`;
}

function historyKey(lotteryId: string) {
  return `${HISTORY_PREFIX}${lotteryId}`;
}

export async function getStrategyProfile(lotteryId: string): Promise<StrategyProfile> {
  try {
    const raw = await SecureStore.getItemAsync(key(lotteryId));
    if (raw) {
      const p = JSON.parse(raw) as StrategyProfile;
      if (p.params && typeof p.version === 'number') return p;
    }
  } catch {
    /* fallback to default */
  }
  return {
    version: 1,
    lotteryId,
    createdAt: new Date().toISOString(),
    params: { ...DEFAULT_WEIGHTS },
  };
}

export async function getStrategyProfileHistory(lotteryId: string): Promise<StrategyProfile[]> {
  try {
    const raw = await SecureStore.getItemAsync(historyKey(lotteryId));
    if (raw) {
      const arr = JSON.parse(raw) as StrategyProfile[];
      if (Array.isArray(arr)) return arr.sort((a, b) => b.version - a.version);
    }
  } catch {
    /* */
  }
  return [];
}

export async function saveStrategyProfile(profile: StrategyProfile): Promise<void> {
  await SecureStore.setItemAsync(key(profile.lotteryId), JSON.stringify(profile));
  const history = await getStrategyProfileHistory(profile.lotteryId);
  const filtered = history.filter((h) => h.version !== profile.version);
  const updated = [profile, ...filtered].slice(0, 10); // keep last 10
  await SecureStore.setItemAsync(historyKey(profile.lotteryId), JSON.stringify(updated));
}

export async function applyAdjustment(
  lotteryId: string,
  current: StrategyProfile,
  deltas: { param: keyof AnalysisWeights; direction: 'increase' | 'decrease'; magnitude: number }[]
): Promise<StrategyProfile> {
  const next: AnalysisWeights = { ...current.params };
  for (const d of deltas) {
    const v = next[d.param];
    if (typeof v !== 'number') continue;
    const delta = d.direction === 'increase' ? d.magnitude : -d.magnitude;
    next[d.param] = Math.max(0, Math.min(1, v + delta));
  }
  const newProfile: StrategyProfile = {
    version: current.version + 1,
    lotteryId,
    createdAt: new Date().toISOString(),
    params: next,
  };
  await saveStrategyProfile(newProfile);
  return newProfile;
}

export async function rollbackToVersion(lotteryId: string, version: number): Promise<StrategyProfile | null> {
  const history = await getStrategyProfileHistory(lotteryId);
  const target = history.find((h) => h.version === version);
  if (!target) return null;
  await SecureStore.setItemAsync(key(lotteryId), JSON.stringify(target));
  return target;
}
