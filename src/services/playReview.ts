import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { shouldRequestPlayReview } from './playReviewPolicy';

const STORAGE_KEY = 'lottopilot.playReview.v1';

type StoredReviewState = {
  openCount: number;
  scanCount: number;
  lastRequestedAt: number | null;
};

const EMPTY: StoredReviewState = { openCount: 0, scanCount: 0, lastRequestedAt: null };

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function normalizeState(raw: unknown): StoredReviewState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const value = raw as Partial<StoredReviewState>;
  const openCount = Number(value.openCount);
  const scanCount = Number(value.scanCount);
  const lastRequestedAt = Number(value.lastRequestedAt);
  return {
    openCount: Number.isFinite(openCount) ? Math.max(0, Math.floor(openCount)) : 0,
    scanCount: Number.isFinite(scanCount) ? Math.max(0, Math.floor(scanCount)) : 0,
    lastRequestedAt: Number.isFinite(lastRequestedAt) ? lastRequestedAt : null,
  };
}

async function readState(): Promise<StoredReviewState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...EMPTY };
  }
}

async function writeState(state: StoredReviewState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function readInstalledAt(): Promise<number | null> {
  try {
    const Application = await import('expo-application');
    const installed = await Application.getInstallationTimeAsync();
    const ms = installed?.getTime?.();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Count one cold start. Android only; Play review is not requested on other platforms. */
export function recordAppOpen(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return enqueue(async () => {
    const state = await readState();
    state.openCount += 1;
    await writeState(state);
  });
}

/** Count one finished document scan (user did not cancel, processing did not throw). */
export function recordCompletedScan(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return enqueue(async () => {
    const state = await readState();
    state.scanCount += 1;
    await writeState(state);
  });
}

/**
 * Ask Google Play to show the in-app review flow when install age, opens, and scans qualify,
 * and the last request was at least 90 days ago. The request time is stored after the API call.
 */
export function maybeRequestPlayReview(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return enqueue(async () => {
    const state = await readState();
    const installedAt = await readInstalledAt();
    const now = Date.now();
    if (
      !shouldRequestPlayReview({
        now,
        installedAt,
        openCount: state.openCount,
        scanCount: state.scanCount,
        lastRequestedAt: state.lastRequestedAt,
      })
    ) {
      return;
    }
    try {
      const StoreReview = await import('expo-store-review');
      if (!(await StoreReview.hasAction())) return;
      await StoreReview.requestReview();
      state.lastRequestedAt = Date.now();
      await writeState(state);
    } catch (e) {
      console.warn('[PlayReview] request failed', e);
    }
  });
}
