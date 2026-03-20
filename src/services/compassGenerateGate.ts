/**
 * Compass Generate Picks: rewarded ad gate logic.
 * Free / unsigned users: after every 3 successful generates, next generate requires rewarded ad.
 * Pirate users: bypass gate (unlimited, ad-free).
 * Count persists across app restarts (AsyncStorage). Not reset by date.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserPlan } from './entitlements';
import { isAdFree } from './adManager';

const GENERATES_BEFORE_AD = 3;
const STORAGE_KEY = '@LottoPilot/freeGenerateCount';

let _freeGenerateCount = 0;
let _initPromise: Promise<void> | null = null;

async function _persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, String(_freeGenerateCount));
  } catch {
    /* ignore */
  }
}

/** Call on app startup to load persisted count. Survives app restart; not reset by date. */
export function initCompassGenerateGate(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      const s = await AsyncStorage.getItem(STORAGE_KEY);
      if (s != null) {
        const n = parseInt(s, 10);
        if (!isNaN(n) && n >= 0) _freeGenerateCount = n;
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

export function incrementFreeGenerateCount(): void {
  _freeGenerateCount += 1;
  _persist();
}

export function resetFreeGenerateCount(): void {
  _freeGenerateCount = 0;
  _persist();
}

/** After watching ad: set count so user gets exactly 1 generate before next ad gate. */
export function setFreeGenerateCountAfterAd(): void {
  _freeGenerateCount = GENERATES_BEFORE_AD - 1;
  _persist();
}

/** Free plan 或未登录 = 需要广告门控 */
function needsAdGate(plan: UserPlan, isSignedIn: boolean | null): boolean {
  if (isAdFree(plan)) return false;
  return true; // free plan 或 未登录
}

/**
 * Check if the next generate requires a rewarded ad gate.
 * Returns true if user must watch ad before generating.
 */
export function requiresRewardedAdGate(plan: UserPlan, isSignedIn?: boolean | null): boolean {
  if (!needsAdGate(plan, isSignedIn ?? true)) return false;
  return _freeGenerateCount >= GENERATES_BEFORE_AD;
}

/**
 * Called after a successful generate. Increments count for free/unsigned users.
 */
export function recordSuccessfulGenerate(plan: UserPlan, isSignedIn?: boolean | null): void {
  if (!needsAdGate(plan, isSignedIn ?? true)) return;
  incrementFreeGenerateCount();
}
