/**
 * Compass: rewarded ad gate for Smart generate and Evaluate current pick.
 * Free / unsigned: two separate counters (AsyncStorage). After 2 successful
 * uses of that action, the next requires ad or Pirate upgrade. Watching the
 * rewarded ad resets **only** that action's counter to 0 (two fresh uses).
 * Pirate: bypass. "View evaluation" does not increment the evaluate counter (UI).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserPlan } from './entitlements';
import { isAdFree } from './adManager';

const ACTIONS_BEFORE_AD = 2;
const STORAGE_KEY_GENERATE = '@LottoPilot/freeGenerateCount';
const STORAGE_KEY_EVALUATE = '@LottoPilot/freeEvaluateCount';

let _freeGenerateCount = 0;
let _freeEvaluateCount = 0;
let _initPromise: Promise<void> | null = null;

async function persistGenerate(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_GENERATE, String(_freeGenerateCount));
  } catch {
    /* ignore */
  }
}

async function persistEvaluate(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_EVALUATE, String(_freeEvaluateCount));
  } catch {
    /* ignore */
  }
}

/** Load persisted counts. Call on app startup. */
export function initCompassGenerateGate(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      const g = await AsyncStorage.getItem(STORAGE_KEY_GENERATE);
      if (g != null) {
        const n = parseInt(g, 10);
        if (!isNaN(n) && n >= 0) _freeGenerateCount = n;
      }
      const e = await AsyncStorage.getItem(STORAGE_KEY_EVALUATE);
      if (e != null) {
        const n = parseInt(e, 10);
        if (!isNaN(n) && n >= 0) _freeEvaluateCount = n;
      }
    } catch {
      /* ignore */
    }
  })();
  return _initPromise;
}

export function getFreeGenerateCount(): number {
  return _freeGenerateCount;
}

export function getFreeEvaluateCount(): number {
  return _freeEvaluateCount;
}

export function incrementFreeGenerateCount(): void {
  _freeGenerateCount += 1;
  persistGenerate();
}

export function incrementFreeEvaluateCount(): void {
  _freeEvaluateCount += 1;
  persistEvaluate();
}

export function resetFreeGenerateCount(): void {
  _freeGenerateCount = 0;
  persistGenerate();
}

export function resetFreeEvaluateCount(): void {
  _freeEvaluateCount = 0;
  persistEvaluate();
}

/**
 * After watching "ad to continue": reset **only** the Smart generate counter to 0
 * so the user gets 2 more generates before the gate. Evaluate counter is unchanged.
 */
export function setFreeGenerateCountAfterAd(): void {
  _freeGenerateCount = 0;
  persistGenerate();
}

/**
 * After watching "ad to continue": reset **only** the Evaluate counter to 0
 * so the user gets 2 more evaluates before the gate. Generate counter is unchanged.
 */
export function setFreeEvaluateCountAfterAd(): void {
  _freeEvaluateCount = 0;
  persistEvaluate();
}

/** Free plan or not signed in → ad gate applies when applicable. */
function needsAdGate(plan: UserPlan, isSignedIn: boolean | null): boolean {
  if (isAdFree(plan)) return false;
  return true;
}

/** Next Smart generate requires rewarded ad (or upgrade). */
export function requiresRewardedAdGate(plan: UserPlan, isSignedIn?: boolean | null): boolean {
  if (!needsAdGate(plan, isSignedIn ?? true)) return false;
  return _freeGenerateCount >= ACTIONS_BEFORE_AD;
}

/** Next Evaluate current pick requires rewarded ad (or upgrade). View evaluation bypasses this in UI. */
export function requiresEvaluateAdGate(plan: UserPlan, isSignedIn?: boolean | null): boolean {
  if (!needsAdGate(plan, isSignedIn ?? true)) return false;
  return _freeEvaluateCount >= ACTIONS_BEFORE_AD;
}

/** After a successful Smart generate (free / unsigned). */
export function recordSuccessfulGenerate(plan: UserPlan, isSignedIn?: boolean | null): void {
  if (!needsAdGate(plan, isSignedIn ?? true)) return;
  incrementFreeGenerateCount();
}

/** After opening Pick Evaluation via "Evaluate current pick" (not View evaluation). */
export function recordSuccessfulEvaluate(plan: UserPlan, isSignedIn?: boolean | null): void {
  if (!needsAdGate(plan, isSignedIn ?? true)) return;
  incrementFreeEvaluateCount();
}
