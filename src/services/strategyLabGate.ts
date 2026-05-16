/**
 * Strategy Lab: rewarded gate after every N successful Generate / Refine (non-Astronaut, Manual mode only).
 * Counts persist in AsyncStorage (no daily reset). Separate counters for Generate vs Refine.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** After this many successful actions, the next one requires a rewarded ad or upgrade. */
export const STRATEGY_LAB_FREE_ACTIONS_BEFORE_GATE = 2;

const KEY_GEN = '@LottoPilot/strategyLab_genCount';
/** Unified refine gate counter (Strategy Lab Refine; counts only free-plan Manual runs). */
const KEY_REF = '@LottoPilot/strategyLab_refCount';
const KEY_REF_AUTO = '@LottoPilot/strategyLab_refCount_auto';
const KEY_REF_MANUAL = '@LottoPilot/strategyLab_refCount_manual';

let refineGateMerged = false;

async function getStoredCount(key: string): Promise<number> {
  const c = await AsyncStorage.getItem(key);
  const n = parseInt(c ?? '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function setStoredCount(key: string, value: number): Promise<void> {
  await AsyncStorage.setItem(key, String(Math.max(0, value)));
}

/** Merge legacy split auto/manual keys into KEY_REF once. */
async function ensureUnifiedRefineGateCount(): Promise<void> {
  if (refineGateMerged) return;
  refineGateMerged = true;
  const auto = await getStoredCount(KEY_REF_AUTO);
  const manual = await getStoredCount(KEY_REF_MANUAL);
  if (auto === 0 && manual === 0) return;
  const existing = await getStoredCount(KEY_REF);
  const merged = existing + auto + manual;
  await setStoredCount(KEY_REF, merged);
  await AsyncStorage.removeItem(KEY_REF_AUTO);
  await AsyncStorage.removeItem(KEY_REF_MANUAL);
}

export async function getStrategyLabGenerateCount(): Promise<number> {
  return getStoredCount(KEY_GEN);
}

export async function getStrategyLabRefineCount(): Promise<number> {
  await ensureUnifiedRefineGateCount();
  return getStoredCount(KEY_REF);
}

export async function recordStrategyLabGenerateSuccess(): Promise<void> {
  const n = await getStrategyLabGenerateCount();
  await setStoredCount(KEY_GEN, n + 1);
}

export async function recordStrategyLabRefineSuccess(): Promise<void> {
  await ensureUnifiedRefineGateCount();
  const n = await getStrategyLabRefineCount();
  await setStoredCount(KEY_REF, n + 1);
}

/** After watching a rewarded ad: allow one more free action before the next gate (same pattern as Compass). */
export async function setStrategyLabGenerateCountAfterAd(): Promise<void> {
  await setStoredCount(KEY_GEN, STRATEGY_LAB_FREE_ACTIONS_BEFORE_GATE - 1);
}

export async function setStrategyLabRefineCountAfterAd(): Promise<void> {
  await ensureUnifiedRefineGateCount();
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
