import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fetchRetry from 'fetch-retry';
import type { Draw } from '../types/lottery';
import type { AddOnCatalogItem } from '../types/addOn';

/** Per-request timeout so hanging fetches throw and trigger retry (default fetch has no timeout) */
const REQUEST_TIMEOUT_MS = 20000;
const DEBUG_FETCH = false; // set true to debug fetch
const _nativeFetch = typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('fetch not available'); })();
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  if (DEBUG_FETCH) console.log('[Supabase] fetch start', url?.slice(0, 80));
  const ctrl = new AbortController();
  const t = setTimeout(() => {
    if (DEBUG_FETCH) console.log('[Supabase] fetch timeout/abort after 20s', url?.slice(0, 50));
    ctrl.abort();
  }, REQUEST_TIMEOUT_MS);
  return _nativeFetch(input, { ...init, signal: ctrl.signal })
    .then((r) => {
      if (DEBUG_FETCH) console.log('[Supabase] fetch ok', r.status, url?.slice(0, 50));
      return r;
    })
    .catch((e) => {
      if (DEBUG_FETCH) console.log('[Supabase] fetch throw', e?.message || e, url?.slice(0, 50));
      throw e;
    })
    .finally(() => clearTimeout(t));
}

/** Custom fetch: 20s per attempt + 4 retries for slow/unstable networks */
const fetchWithRetry = fetchRetry(fetchWithTimeout, {
  retries: 4,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  retryOn: [], // retry on any throw (timeout, network, DNS)
});

const REMEMBER_ME_KEY = 'lottopilot_remember_me';
const LAST_LOGIN_EMAIL_KEY = 'lottopilot_last_login_email';
const AUTH_TIMEOUT_MS = 30000;

/** Use SQLite-backed localStorage (polyfilled in index.ts) - survives OTA updates better than AsyncStorage */
function getStorage(): Storage | null {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as unknown as { localStorage?: Storage }).localStorage !== 'undefined') {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
}

export async function setRememberMe(value: boolean): Promise<void> {
  const storage = getStorage();
  if (storage) {
    storage.setItem(REMEMBER_ME_KEY, value ? 'true' : 'false');
  }
}

export async function getRememberMe(): Promise<boolean> {
  const storage = getStorage();
  if (storage) {
    return storage.getItem(REMEMBER_ME_KEY) !== 'false';
  }
  return true;
}

export function setLastLoginEmail(email: string): void {
  const storage = getStorage();
  if (storage) storage.setItem(LAST_LOGIN_EMAIL_KEY, email.trim().toLowerCase());
}

export function getLastLoginEmail(): string | null {
  const storage = getStorage();
  return storage?.getItem(LAST_LOGIN_EMAIL_KEY) ?? null;
}

let _supabase: SupabaseClient | null = null;

function getSupabaseConfig(): { url: string; key: string } {
  const fromEnv = process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (fromEnv) {
    return {
      url: process.env.EXPO_PUBLIC_SUPABASE_URL!,
      key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    };
  }
  const extra = (Constants.expoConfig as { extra?: { supabaseUrl?: string; supabaseAnonKey?: string } })?.extra;
  return {
    url: extra?.supabaseUrl || '',
    key: extra?.supabaseAnonKey || '',
  };
}

/** If value looks like JSON, validate it. Corrupted JSON after crash causes Supabase to throw. */
function sanitizeStoredSession(value: string | null): string | null {
  if (!value) return null;
  try {
    JSON.parse(value);
    return value;
  } catch {
    return null;
  }
}

/** Read session from storage without Supabase client (avoids auth blocking). Returns { userId, accessToken, email } or null. */
function getSessionFromStorage(): { userId: string; accessToken: string; email?: string } | null {
  const storage = getStorage();
  if (!storage || storage.getItem(REMEMBER_ME_KEY) === 'false') return null;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || (!k.startsWith('sb-') && !k.includes('-auth-token'))) continue;
      const raw = sanitizeStoredSession(storage.getItem(k));
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const session = (parsed.currentSession ?? parsed.session ?? parsed) as Record<string, unknown> | undefined;
      if (!session) continue;
      const user = (session.user ?? session) as { id?: string; email?: string } | undefined;
      const accessToken = (session.access_token ?? session.accessToken) as string | undefined;
      const userId = user?.id ?? (session as { user_id?: string }).user_id;
      if (userId && accessToken) {
        return { userId: String(userId), accessToken, email: user?.email };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** One-time migration: copy Supabase session from AsyncStorage to SQLite localStorage (for users updating from old version) */
export async function migrateAuthFromAsyncStorage(): Promise<void> {
  const storage = getStorage();
  if (!storage || Platform.OS === 'web') return;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const sbKeys = keys.filter((k) => k.startsWith('sb-') || (k.includes('supabase') && k.includes('auth')));
    for (const k of sbKeys) {
      const val = await AsyncStorage.getItem(k);
      if (val && sanitizeStoredSession(val) && !storage.getItem(k)) {
        storage.setItem(k, val);
      }
    }
  } catch {
    /* ignore */
  }
}

/** Use SQLite-backed localStorage (polyfilled in index.ts) - survives OTA updates better than AsyncStorage */
function createAuthStorage(): { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void>; removeItem: (k: string) => Promise<void> } | undefined {
  const storage = getStorage();
  if (!storage) return undefined;
  return {
    getItem: async (key: string) => {
      try {
        if (storage.getItem(REMEMBER_ME_KEY) === 'false') return null;
        return sanitizeStoredSession(storage.getItem(key));
      } catch {
        return null;
      }
    },
    setItem: async (key: string, value: string) => {
      try {
        if (storage.getItem(REMEMBER_ME_KEY) === 'false') return;
        storage.setItem(key, value);
      } catch {
        /* ignore - storage may be corrupted after crash */
      }
    },
    removeItem: async (key: string) => {
      try {
        if (storage.getItem(REMEMBER_ME_KEY) === 'false') return;
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** No-op lock to avoid NavigatorLockAcquireTimeoutError on web (dev hot reload, multiple tabs). */
const lockNoOp = async <T>(_name: string, _acquireTimeout: number, fn: () => Promise<T>) => fn();

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  const storage = createAuthStorage();
  const isWeb = Platform.OS === 'web';
  try {
    _supabase = createClient(url, key, {
      global: { fetch: fetchWithRetry },
      auth: {
        ...(storage ? { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } : {}),
        ...(isWeb ? { lock: lockNoOp } : {}),
      },
    });
  } catch (e) {
    console.warn('Supabase createClient failed, retrying without auth storage:', e);
    _supabase = createClient(url, key, {
      global: { fetch: fetchWithRetry },
      auth: { persistSession: false, ...(isWeb ? { lock: lockNoOp } : {}) },
    });
  }
  return _supabase;
}

/** Shared Supabase client for addOnCatalog, prizeRules, etc. Avoids multiple GoTrueClient instances. */
export function getSupabaseClient() {
  return getSupabase();
}

/** Clear Supabase auth keys from storage to recover from corrupted state. */
async function clearSupabaseAuthStorage(): Promise<void> {
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

/** Reset Supabase client (e.g. after crash recovery). Clears singleton so next call creates fresh client. */
export function resetSupabaseClient(): void {
  _supabase = null;
}

/** Reset client and clear auth storage. Only call when auth is corrupted (401/JWT), NOT on network errors. */
export async function resetSupabaseAndClearStorage(): Promise<void> {
  _supabase = null;
  await clearSupabaseAuthStorage();
  const { setCacheClearFlag } = await import('../utils/storageVersionCheck');
  setCacheClearFlag();
  notifyAuthStateChange();
}

/** True if error indicates auth/session problem (401, JWT invalid). Do NOT clear on timeout/network errors. */
export function isAuthError(e: unknown): boolean {
  const msg = (e as Error)?.message ?? String(e);
  const code = (e as { code?: string })?.code;
  if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('network') || msg.includes('fetch')) return false;
  return (
    code === 'PGRST301' ||
    code === 'invalid_jwt' ||
    msg.includes('invalid claim') ||
    msg.includes('401') ||
    msg.includes('refresh_token') ||
    (msg.includes('JWT') && !msg.includes('timeout')) ||
    (msg.includes('session') && !msg.includes('validate timeout'))
  );
}

/** For diagnostics: check if Supabase is configured */
export function isSupabaseConfigured(): boolean {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

/** Sync check: does storage have a valid session? (no client, no auth blocking) */
export function hasSessionInStorage(): boolean {
  return getSessionFromStorage() !== null;
}

/** Test Supabase connection. Returns { ok, message } for Settings diagnostics. */
export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return { ok: false, message: 'Supabase not configured' };
  try {
    const res = await fetchWithRetry(`${url}/rest/v1/draws?limit=1`, {
      method: 'GET',
      headers: { apikey: key, Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    return { ok: true, message: 'Connected' };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return { ok: false, message: msg || 'Network request failed' };
  }
}

/** Call early on startup to create client before any fetch. Ensures singleton exists. */
export function preWarmSupabaseClient(): void {
  getSupabase();
}

const AUTH_SESSION_TIMEOUT_MS = 10000;

async function getSessionWithTimeout(): Promise<{ session: { user?: { id?: string; email?: string } } | null } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Session timeout')), AUTH_SESSION_TIMEOUT_MS)
  );
  try {
    const { data } = await Promise.race([supabase.auth.getSession(), timeout]);
    return data;
  } catch {
    return null;
  }
}

/** Get current signed-in user id. Tries storage first (fast, no client), then client. */
export async function getCurrentUserId(): Promise<string | null> {
  const fromStorage = getSessionFromStorage();
  if (fromStorage?.userId) return fromStorage.userId;
  const data = await getSessionWithTimeout();
  return data?.session?.user?.id ?? null;
}

/** Get current signed-in user email. Tries storage first (fast, no client), then client. */
export async function getCurrentUserEmail(): Promise<string | null> {
  const fromStorage = getSessionFromStorage();
  if (fromStorage?.email) return fromStorage.email.trim().toLowerCase();
  const data = await getSessionWithTimeout();
  const email = data?.session?.user?.email;
  return email ? email.trim().toLowerCase() : null;
}

/** Refresh session from stored refresh token. Call on app startup and when app becomes active.
 * JWT expires in ~1h; must call refreshSession to get new access_token. */
export async function tryRefreshSession(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.auth.refreshSession();
  } catch {
    /* ignore - network or storage issue */
  }
}

const VALIDATE_SESSION_TIMEOUT_MS = 8000;

/**
 * Validate session on startup (native only). If stored session exists but refresh fails (auth error),
 * clear auth storage and set cache-clear flag. Call before initDb so caches get cleared.
 * On timeout: keep existing session, do not clear - avoids flaky behavior on slow networks.
 */
export async function validateSessionOnStartup(): Promise<void> {
  if (Platform.OS === 'web') return;
  const supabase = getSupabase();
  if (!supabase) return;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Session validate timeout')), VALIDATE_SESSION_TIMEOUT_MS)
  );
  try {
    await Promise.race([supabase.auth.refreshSession(), timeoutPromise]);
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    const isTimeout = msg.includes('timeout') || msg.includes('Timeout');
    if (!isTimeout && isAuthError(e)) {
      await resetSupabaseAndClearStorage();
      const { setCacheClearFlag } = await import('../utils/storageVersionCheck');
      setCacheClearFlag();
    }
    // On timeout/network: keep session, user can retry when online
  }
}

/** Direct REST: sign in with password (avoids Supabase client blocking). */
async function signInDirect(email: string, password: string): Promise<{ error: string | null }> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return { error: 'Supabase not configured' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AUTH_TIMEOUT_MS);
  try {
    const res = await _nativeFetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'password', email: email.trim(), password }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    const data = (await res.json()) as { access_token?: string; user?: { id: string; email?: string }; error_description?: string; msg?: string };
    if (!res.ok) {
      return { error: data?.error_description ?? data?.msg ?? `HTTP ${res.status}` };
    }
    if (!data?.access_token || !data?.user?.id) {
      return { error: 'Invalid response' };
    }
    const session = {
      access_token: data.access_token,
      refresh_token: (data as { refresh_token?: string }).refresh_token ?? '',
      expires_at: (data as { expires_at?: number }).expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      user: data.user,
    };
    const storage = getStorage();
    if (storage && storage.getItem(REMEMBER_ME_KEY) !== 'false') {
      const { url: u } = getSupabaseConfig();
      const ref = u?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? 'default';
      storage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ currentSession: session, expiresAt: session.expires_at * 1000 }));
    }
    try {
      const supabase = getSupabase();
      if (supabase) await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    } catch {
      /* client may fail - storage already written */
    }
    notifyAuthStateChange();
    return { error: null };
  } catch (e) {
    return { error: (e as Error)?.message ?? 'Sign in failed' };
  }
}

/** Sign in with email and password. Tries direct REST first (no client blocking), falls back to client. */
export async function signIn(email: string, password: string): Promise<{ error: string | null }> {
  const direct = await signInDirect(email, password);
  if (direct.error === null) return direct;
  const supabase = getSupabase();
  if (!supabase) return direct;
  const signInPromise = supabase.auth.signInWithPassword({ email: email.trim(), password });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out. Check your connection and try again.')), AUTH_TIMEOUT_MS)
  );
  try {
    const { error } = await Promise.race([signInPromise, timeoutPromise]);
    return { error: error?.message ?? null };
  } catch (e) {
    return { error: (e as Error)?.message ?? direct.error ?? 'Sign in failed' };
  }
}

/** Get redirect URL for email confirmation / magic link.
 * Use EXPO_PUBLIC_AUTH_CALLBACK_URL (HTTPS) for native - opens in browser first, then redirects to app.
 * Web: current origin. Fallback: lottopilot://auth/callback (direct, may not work in mobile browser). */
export function getAuthRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin + (window.location.pathname || '/');
  }
  const extra = (Constants.expoConfig as { extra?: { authCallbackUrl?: string } })?.extra;
  const httpsCallback = extra?.authCallbackUrl || process.env.EXPO_PUBLIC_AUTH_CALLBACK_URL;
  if (httpsCallback && typeof httpsCallback === 'string' && httpsCallback.startsWith('https://')) {
    return httpsCallback.replace(/\/$/, '');
  }
  return 'lottopilot://auth/callback';
}

/** Sign up with email and password. Returns session if user is immediately signed in (no email confirm). */
export async function signUp(email: string, password: string): Promise<{ error: string | null; session: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { error: 'Supabase not configured', session: false };
  const signUpPromise = supabase.auth.signUp(
    { email: email.trim(), password },
    { emailRedirectTo: getAuthRedirectUrl() }
  );
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out. Check your connection and try again.')), AUTH_TIMEOUT_MS)
  );
  try {
    const { data, error } = await Promise.race([signUpPromise, timeoutPromise]);
    return { error: error?.message ?? null, session: !!data?.session };
  } catch (e) {
    return { error: (e as Error)?.message ?? 'Sign up failed', session: false };
  }
}

/** Set session from auth callback URL (e.g. email confirmation link). Returns true if session was set. */
export async function setSessionFromAuthUrl(url: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const hash = url.includes('#') ? url.split('#')[1] : '';
  if (!hash) return false;
  const params: Record<string, string> = {};
  hash.split('&').forEach((p) => {
    const [k, v] = p.split('=');
    if (k && v) params[k] = decodeURIComponent(v.replace(/\+/g, ' '));
  });
  const access_token = params.access_token;
  const refresh_token = params.refresh_token;
  if (!access_token) return false;
  try {
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token: refresh_token ?? '',
    });
    return !error;
  } catch {
    return false;
  }
}

/** Send password reset email. */
export async function resetPasswordForEmail(email: string): Promise<{ error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { error: 'Supabase not configured' };
  const redirectTo = getAuthRedirectUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo,
  });
  return { error: error?.message ?? null };
}

/** Sign out current user. Clears storage first (no client), then client if available. */
export async function signOut(): Promise<void> {
  const { clearEntitlementsOnLogout } = await import('./entitlements');
  await clearEntitlementsOnLogout();
  await clearSupabaseAuthStorage();
  notifyAuthStateChange();
  try {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
  } catch {
    /* client may block - storage already cleared */
  }
}

const _authListeners: Array<() => void> = [];
/** Notify auth state changed (e.g. after signInDirect). Call getCurrentUserEmail in listener. Also use after entitlements sync to refresh UI. */
export function notifyAuthStateChange(): void {
  _authListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

/** Subscribe to auth state changes. Uses storage-first getCurrentUserEmail (no client blocking). Returns unsubscribe function. */
export function onAuthStateChange(callback: (email: string | null) => void): () => void {
  const run = async () => {
    const email = await getCurrentUserEmail();
    callback(email);
  };
  _authListeners.push(run);
  void run();
  let unsubClient: (() => void) | null = null;
  try {
    const supabase = getSupabase();
    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(run);
      unsubClient = () => subscription.unsubscribe();
    }
  } catch {
    /* client may block - we still have our listener */
  }
  return () => {
    const i = _authListeners.indexOf(run);
    if (i >= 0) _authListeners.splice(i, 1);
    unsubClient?.();
  };
}

/** Minimal columns (001 schema) - avoids errors if migrations 003+ not applied */
const DRAWS_SELECT_MIN = 'id, lottery_id, draw_date, winning_numbers, special_numbers, jackpot_cents';
/** Full columns for add-ons (EXTRA, ENCORE, TAG, Power Play, etc.) */
const DRAWS_SELECT_FULL =
  'id, lottery_id, draw_date, winning_numbers, special_numbers, bonus_numbers, jackpot_cents, extra_number, encore_number, tag_number, power_play_multiplier, double_play_numbers_json, maxmillions_numbers_json, mega_multiplier';

function normalizeDraw(raw: Record<string, unknown>): Draw & Record<string, unknown> {
  const wn = raw.winning_numbers;
  const winning_numbers = Array.isArray(wn)
    ? wn.map((n) => (typeof n === 'number' ? n : parseInt(String(n), 10) || 0))
    : [];
  let sn = raw.special_numbers;
  if (!Array.isArray(sn) || sn.length === 0) {
    sn = raw.bonus_numbers;
  }
  const special_numbers = Array.isArray(sn)
    ? sn.map((n) => (typeof n === 'number' ? n : parseInt(String(n), 10) || 0)).filter((n) => !isNaN(n) && n > 0)
    : undefined;
  const base: Draw = {
    id: String(raw.id ?? raw.draw_date ?? ''),
    lottery_id: String(raw.lottery_id ?? ''),
    draw_date: String(raw.draw_date ?? ''),
    winning_numbers,
    special_numbers: special_numbers?.length ? special_numbers : undefined,
    jackpot_cents: typeof raw.jackpot_cents === 'number' ? raw.jackpot_cents : undefined,
  };
  return { ...base, ...raw } as Draw & Record<string, unknown>;
}

function postProcessDraw(d: Draw & Record<string, unknown>, lotteryId: string): Draw & Record<string, unknown> {
  const mainCount = { lotto_max: 7, lotto_649: 6, powerball: 5, mega_millions: 5 }[lotteryId] ?? 7;
  if ((lotteryId === 'lotto_max' || lotteryId === 'lotto_649') && !d.special_numbers?.length && d.winning_numbers.length === mainCount + 1) {
    return {
      ...d,
      winning_numbers: d.winning_numbers.slice(0, mainCount),
      special_numbers: d.winning_numbers.slice(mainCount, mainCount + 1),
    };
  }
  return d;
}

/** Direct REST fetch - bypasses Supabase client (avoids auth/session blocking on web) */
async function fetchDrawsDirect(lotteryId: string, limit: number): Promise<Draw[]> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return [];
  const headers = { apikey: key, Accept: 'application/json', 'Content-Type': 'application/json' };
  const doFetch = async (select: string) => {
    const selectNoSpaces = select.replace(/\s+/g, '');
    const restUrl = `${url}/rest/v1/draws?lottery_id=eq.${encodeURIComponent(lotteryId)}&order=draw_date.desc&limit=${limit}&select=${encodeURIComponent(selectNoSpaces)}`;
    if (DEBUG_FETCH) console.log('[Supabase] fetchDrawsDirect', select === DRAWS_SELECT_FULL ? 'FULL' : 'MIN');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await _nativeFetch(restUrl, { method: 'GET', headers, signal: ctrl.signal }).finally(() => clearTimeout(t));
    return res;
  };
  let res = await doFetch(DRAWS_SELECT_FULL);
  if (!res.ok && res.status === 400) {
    res = await doFetch(DRAWS_SELECT_MIN);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  if (DEBUG_FETCH) console.log('[Supabase] fetchDrawsDirect ok', rows?.length);
  return rows.map((r) => postProcessDraw(normalizeDraw(r), lotteryId));
}

async function fetchDrawsInner(supabase: NonNullable<ReturnType<typeof getSupabase>>, lotteryId: string, limit: number): Promise<Draw[]> {
  if (DEBUG_FETCH) console.log('[Supabase] fetchDrawsInner start', lotteryId);
  let select = DRAWS_SELECT_FULL;
  let { data, error } = await supabase
    .from('draws')
    .select(select)
    .eq('lottery_id', lotteryId)
    .order('draw_date', { ascending: false })
    .limit(limit);
  if (error && (error.message?.includes('column') || error.code === 'PGRST204')) {
    select = DRAWS_SELECT_MIN;
    const retry = await supabase
      .from('draws')
      .select(select)
      .eq('lottery_id', lotteryId)
      .order('draw_date', { ascending: false })
      .limit(limit);
    data = retry.data;
    error = retry.error;
  }
  if (error) {
    if (DEBUG_FETCH) console.log('[Supabase] fetchDrawsInner error', error?.message);
    throw error;
  }
  const rows = (data || []) as Record<string, unknown>[];
  if (DEBUG_FETCH) console.log('[Supabase] fetchDrawsInner ok rows', rows?.length);
  return rows.map((r) => postProcessDraw(normalizeDraw(r), lotteryId));
}

/** 90s to allow fetch-retry (4×20s attempts + backoff ~15s) on slow/unstable networks */
const FETCH_DRAWS_TIMEOUT_MS = 90000;
const COMPASS_FETCH_TIMEOUT_MS = 120000;

export async function fetchDraws(lotteryId: string, limit = 20): Promise<Draw[]> {
  if (DEBUG_FETCH) console.log('[Supabase] fetchDraws start', lotteryId);
  const withTimeout = <T>(p: Promise<T>) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          if (DEBUG_FETCH) console.log('[Supabase] fetchDraws outer timeout', FETCH_DRAWS_TIMEOUT_MS, 'ms');
          reject(new Error('Request timed out. Check your connection.'));
        }, FETCH_DRAWS_TIMEOUT_MS)
      ),
    ]);
  try {
    const out = await withTimeout(fetchDrawsDirect(lotteryId, limit));
    if (DEBUG_FETCH) console.log('[Supabase] fetchDraws ok (direct)', lotteryId, out?.length);
    return out;
  } catch (e) {
    if (DEBUG_FETCH) console.log('[Supabase] fetchDraws direct catch', (e as Error)?.message);
    throw e;
  }
}

export async function fetchLatestDraw(lotteryId: string): Promise<Draw | null> {
  const draws = await fetchDraws(lotteryId, 1);
  return draws[0] || null;
}

/** Fetch many draws for Compass (historical analysis). Limit up to 2000. Uses direct REST like fetchDraws. */
export async function fetchDrawsForCompass(lotteryId: string, limit = 500): Promise<Draw[]> {
  const capped = Math.min(limit, 2000);
  return withCompassTimeout(fetchDrawsDirect(lotteryId, capped));
}

function withCompassTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Compass request timed out.')), COMPASS_FETCH_TIMEOUT_MS)
    ),
  ]);
}

/** Fetch pre-computed Compass snapshot. Uses direct REST to avoid client blocking. */
export async function fetchCompassSnapshot(gameCode: string): Promise<{
  payload_json: unknown;
  computed_at: string;
} | null> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  const restUrl = `${url}/rest/v1/compass_snapshots?game_code=eq.${encodeURIComponent(gameCode)}&select=payload_json,computed_at&limit=1`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await _nativeFetch(restUrl, {
      method: 'GET',
      headers: { apikey: key, Accept: 'application/json' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const rows = (await res.json()) as { payload_json: unknown; computed_at: string }[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Fetch single draw by date. Uses direct REST to avoid client blocking. */
export async function fetchDrawByDate(lotteryId: string, drawDate: string): Promise<Draw | null> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  const headers = { apikey: key, Accept: 'application/json' };
  const doFetch = async (select: string) => {
    const sel = select.replace(/\s+/g, '');
    const restUrl = `${url}/rest/v1/draws?lottery_id=eq.${encodeURIComponent(lotteryId)}&draw_date=eq.${encodeURIComponent(drawDate)}&select=${encodeURIComponent(sel)}&limit=1`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await _nativeFetch(restUrl, { method: 'GET', headers, signal: ctrl.signal }).finally(() => clearTimeout(t));
    return res;
  };
  let res = await doFetch(DRAWS_SELECT_FULL);
  if (!res.ok && res.status === 400) res = await doFetch(DRAWS_SELECT_MIN);
  if (!res.ok) return null;
  const rows = (await res.json()) as Record<string, unknown>[];
  if (!rows?.[0]) return null;
  return postProcessDraw(normalizeDraw(rows[0]), lotteryId);
}

/** Direct REST: add_on_catalog. Avoids Supabase client blocking. */
export async function fetchAddOnCatalogDirect(
  gameCode: string,
  jurisdictionCode: string
): Promise<AddOnCatalogItem[]> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return [];
  const jCode = jurisdictionCode || 'CA-ON';
  const country = jCode.split('-')[0];
  const nationalCode = `${country}-NATIONAL`;
  const headers = { apikey: key, Accept: 'application/json' };
  const fetchOne = async (jc: string) => {
    const restUrl = `${url}/rest/v1/add_on_catalog?game_code=eq.${encodeURIComponent(gameCode)}&jurisdiction_code=eq.${encodeURIComponent(jc)}&is_enabled=eq.true&select=*`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await _nativeFetch(restUrl, { method: 'GET', headers, signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return [];
    return (await res.json()) as AddOnCatalogItem[];
  };
  const [exactData, nationalData] = await Promise.all([fetchOne(jCode), fetchOne(nationalCode)]);
  const byCode = new Map<string, AddOnCatalogItem>();
  for (const i of exactData) byCode.set(i.add_on_code, i);
  for (const i of nationalData) if (!byCode.has(i.add_on_code)) byCode.set(i.add_on_code, i);
  return Array.from(byCode.values());
}

/** Direct REST: prize_rule_sets + tiers + add_on_rules. Avoids Supabase client blocking. */
export async function loadRuleSetDirect(
  gameCode: string,
  jurisdictionCode: string,
  drawDate: string
): Promise<{ ruleSet: Record<string, unknown>; tiers: Record<string, unknown>[]; addOns: Record<string, unknown>[] } | null> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  const headers = { apikey: key, Accept: 'application/json' };
  const fetchTable = async (table: string, params: string) => {
    const restUrl = `${url}/rest/v1/${table}?${params}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await _nativeFetch(restUrl, { method: 'GET', headers, signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return [];
    return (await res.json()) as Record<string, unknown>[];
  };
  const setsParams = `game_code=eq.${encodeURIComponent(gameCode)}&jurisdiction_code=eq.${encodeURIComponent(jurisdictionCode)}&is_active=eq.true&effective_from=lte.${encodeURIComponent(drawDate)}&or=(effective_to.is.null,effective_to.gte.${encodeURIComponent(drawDate)})&order=effective_from.desc&limit=1&select=*`;
  const sets = await fetchTable('prize_rule_sets', setsParams);
  if (!sets?.length) return null;
  const ruleSet = sets[0];
  const ruleSetId = String(ruleSet.id ?? '');
  const [tiers, addOns] = await Promise.all([
    fetchTable('prize_tiers', `rule_set_id=eq.${ruleSetId}&order=sort_order.asc&select=*`),
    fetchTable('add_on_rules', `rule_set_id=eq.${ruleSetId}&select=*`),
  ]);
  return { ruleSet, tiers: tiers || [], addOns: addOns || [] };
}

/** Direct REST: fetch entitlements (avoids Supabase client blocking). Requires session from storage. */
async function fetchEntitlementsDirect(uid: string, accessToken: string): Promise<{
  compass_unlock: boolean;
  pro_unlock: boolean;
  pro_trial_ends: string | null;
  had_astronaut_subscription: boolean;
} | null> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  const restUrl = `${url}/rest/v1/entitlements?user_id=eq.${encodeURIComponent(uid)}&select=compass_unlock,pro_unlock,pro_trial_ends,had_astronaut_subscription&limit=1`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await _nativeFetch(restUrl, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const rows = (await res.json()) as Record<string, unknown>[];
    const data = rows?.[0];
    if (!data) return null;
    return {
      compass_unlock: Boolean(data.compass_unlock),
      pro_unlock: Boolean(data.pro_unlock),
      pro_trial_ends: (data.pro_trial_ends as string) ?? null,
      had_astronaut_subscription: Boolean(data.had_astronaut_subscription),
    };
  } catch {
    return null;
  }
}

/** Server-side entitlements: fetch for current user. Uses storage + direct REST first (no client blocking). */
export async function fetchEntitlementsFromSupabase(): Promise<{
  compass_unlock: boolean;
  pro_unlock: boolean;
  pro_trial_ends: string | null;
  had_astronaut_subscription: boolean;
} | null> {
  const session = getSessionFromStorage();
  if (session?.userId && session?.accessToken) {
    const direct = await fetchEntitlementsDirect(session.userId, session.accessToken);
    if (direct) return direct;
  }
  const supabase = getSupabase();
  if (!supabase) return null;
  const uid = await getCurrentUserId();
  if (!uid) return null;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Entitlements timeout')), 15000)
  );
  try {
    const fetchPromise = supabase
      .from('entitlements')
      .select('compass_unlock, pro_unlock, pro_trial_ends, had_astronaut_subscription')
      .eq('user_id', uid)
      .maybeSingle();
    const { data, error } = await Promise.race([fetchPromise, timeout]);
    if (error) return null;
    if (!data) return null;
    return {
      compass_unlock: Boolean(data.compass_unlock),
      pro_unlock: Boolean(data.pro_unlock),
      pro_trial_ends: data.pro_trial_ends ?? null,
      had_astronaut_subscription: Boolean(data.had_astronaut_subscription),
    };
  } catch {
    return null;
  }
}

/** Direct REST: upsert entitlements (avoids Supabase client blocking). */
async function upsertEntitlementsDirect(
  uid: string,
  accessToken: string,
  payload: { compass_unlock: boolean; pro_unlock: boolean; pro_trial_ends: string | null; had_astronaut_subscription?: boolean }
): Promise<void> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;
  const row: Record<string, unknown> = {
    user_id: uid,
    compass_unlock: payload.compass_unlock,
    pro_unlock: payload.pro_unlock,
    pro_trial_ends: payload.pro_trial_ends,
    updated_at: new Date().toISOString(),
  };
  if (payload.had_astronaut_subscription === true) row.had_astronaut_subscription = true;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await _nativeFetch(`${url}/rest/v1/entitlements`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) return;
  } catch {
    /* ignore */
  }
}

/** Server-side entitlements: upsert for current user. Uses storage + direct REST first (no client blocking). */
export async function upsertEntitlementsToSupabase(payload: {
  compass_unlock: boolean;
  pro_unlock: boolean;
  pro_trial_ends: string | null;
  had_astronaut_subscription?: boolean;
}): Promise<void> {
  const session = getSessionFromStorage();
  if (session?.userId && session?.accessToken) {
    await upsertEntitlementsDirect(session.userId, session.accessToken, payload);
    return;
  }
  const supabase = getSupabase();
  if (!supabase) return;
  const uid = await getCurrentUserId();
  if (!uid) return;
  try {
    const row: Record<string, unknown> = {
      user_id: uid,
      compass_unlock: payload.compass_unlock,
      pro_unlock: payload.pro_unlock,
      pro_trial_ends: payload.pro_trial_ends,
      updated_at: new Date().toISOString(),
    };
    if (payload.had_astronaut_subscription === true) row.had_astronaut_subscription = true;
    await supabase.from('entitlements').upsert(row, { onConflict: 'user_id' });
  } catch {
    /* ignore - network or RLS */
  }
}
