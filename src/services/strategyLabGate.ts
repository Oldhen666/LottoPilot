/**
 * Strategy Lab: rewarded gate after every N successful Generate / Refine (non-Astronaut).
 * Counts persist in AsyncStorage (no daily reset). Separate counters for Generate vs Refine.
 *
 * Refine: first STRATEGY_LAB_FREE_ACTIONS_BEFORE_GATE successful "Compute" runs are free;
 * the next run requires a rewarded ad or upgrade (counter >= same threshold).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** After this many successful actions, the next one requires an ad or subscription. */
export const STRATEGY_LAB_FREE_ACTIONS_BEFORE_GATE = 2;

const KEY_GEN = '@LottoPilot/strategyLab_genCount';
const KEY_REF = '@LottoPilot/strategyLab_refCount';

async function getStoredCount(key: string): Promise<number> {
  const c = await AsyncStorage.getItem(key);
  const n = parseInt(c ?? '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function setStoredCount(key: string, value: number): Promise<void> {
  await AsyncStorage.setItem(key, String(Math.max(0, value)));
}

export async function getStrategyLabGenerateCount(): Promise<number> {
  return getStoredCount(KEY_GEN);
}

export async function getStrategyLabRefineCount(): Promise<number> {
  return getStoredCount(KEY_REF);
}

export async function recordStrategyLabGenerateSuccess(): Promise<void> {
  const n = await getStrategyLabGenerateCount();
  await setStoredCount(KEY_GEN, n + 1);
}

export async function recordStrategyLabRefineSuccess(): Promise<void> {
  const n = await getStrategyLabRefineCount();
  await setStoredCount(KEY_REF, n + 1);
}

/** After watching a rewarded ad: allow one more free action before the next gate (same pattern as Compass). */
export async function setStrategyLabGenerateCountAfterAd(): Promise<void> {
  await setStoredCount(KEY_GEN, STRATEGY_LAB_FREE_ACTIONS_BEFORE_GATE - 1);
}

export async function setStrategyLabRefineCountAfterAd(): Promise<void> {
  await setStoredCount(KEY_REF, STRATEGY_LAB_FREE_ACTIONS_BEFORE_GATE - 1);
}

export async function needsRewardGateForGenerate(proUnlocked: boolean): Promise<boolean> {
  if (proUnlocked) return false;
  const n = await getStrategyLabGenerateCount();
  return n >= STRATEGY_LAB_FREE_ACTIONS_BEFORE_GATE;
}

export async function needsRewardGateForRefine(proUnlocked: boolean): Promise<boolean> {
  if (proUnlocked) return false;
  const n = await getStrategyLabRefineCount();
  return n >= STRATEGY_LAB_FREE_ACTIONS_BEFORE_GATE;
}
