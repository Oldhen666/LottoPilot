/**
 * Storage version check. Only clears auth when AUTH_STORAGE_VERSION changes (breaking format).
 * Do NOT clear on app version change - that was too aggressive and broke first open after update.
 */
import { Platform } from 'react-native';

const STORAGE_VERSION_KEY = 'lottopilot_storage_version';
const CACHE_CLEAR_FLAG_KEY = 'lottopilot_need_cache_clear';
/** Bump only when auth storage format breaks and we must clear. */
const AUTH_STORAGE_VERSION = 1;

function getStorage(): Storage | null {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as unknown as { localStorage?: Storage }).localStorage !== 'undefined') {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
}

/** Set flag so initDb clears draws_cache and compass_cache. Call when auth/session was invalidated. */
export function setCacheClearFlag(): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(CACHE_CLEAR_FLAG_KEY, '1');
    } catch {
      /* ignore */
    }
  }
}

/** Clear Supabase auth keys when AUTH_STORAGE_VERSION changes. */
function clearAuthStorage(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && (k.startsWith('sb-') || k.includes('-auth-token') || (k.includes('supabase') && k.includes('auth')))) {
        keys.push(k);
      }
    }
    keys.forEach((k) => {
      try {
        storage.removeItem(k);
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

/**
 * Run early (before App mounts). Clears auth only when AUTH_STORAGE_VERSION changes.
 * @returns true if auth was cleared (caller should reset Supabase client)
 */
export async function runEarlyStorageVersionCheck(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const storage = getStorage();
  if (!storage) return false;
  try {
    const current = String(AUTH_STORAGE_VERSION);
    const stored = storage.getItem(STORAGE_VERSION_KEY);
    if (stored !== null && stored !== current) {
      clearAuthStorage();
      storage.setItem(CACHE_CLEAR_FLAG_KEY, '1');
      storage.setItem(STORAGE_VERSION_KEY, current);
      return true;
    }
    storage.setItem(STORAGE_VERSION_KEY, current);
  } catch {
    /* ignore - storage may be unavailable */
  }
  return false;
}

/**
 * Check if cache clear was requested by early check. Call from initDb after schema is ready.
 * Returns true if caches were cleared.
 */
export function shouldClearDataCaches(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const flag = storage.getItem(CACHE_CLEAR_FLAG_KEY);
    if (flag === '1') {
      storage.removeItem(CACHE_CLEAR_FLAG_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
