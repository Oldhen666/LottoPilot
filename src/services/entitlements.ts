/**
 * Entitlement storage: Pro unlock, AI subscription (reserved).
 * Server-side: Supabase entitlements table when signed in. Local SecureStore as cache/fallback.
 * Admin emails get all permissions unlocked.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { fetchEntitlementsFromSupabase, upsertEntitlementsToSupabase } from './supabase';

const PRO_UNLOCK_KEY = 'lottopilot_pro_unlocked';
const PRO_TRIAL_ENDS_KEY = 'lottopilot_pro_trial_ends';
const AI_SUB_KEY = 'lottopilot_ai_subscribed';
const COMPASS_UNLOCK_KEY = 'lottopilot_compass_unlocked';
const COMPASS_USED_KEY = 'lottopilot_compass_used';

const MAX_FREE_COMPASS_USES = 10;

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

async function deleteItem(key: string): Promise<void> {
  if (isWeb && typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** Admin emails: full Pro + AI access */
export const ADMIN_EMAILS: string[] = ['chenk@dybridge.com'];

/** User plans: Free (default), Pirate (Compass), Astronaut (Strategy Lab) */
export type UserPlan = 'free' | 'pirate' | 'astronaut' | 'pirate_astronaut';

export const PLAN_LABELS: Record<UserPlan, string> = {
  free: 'Free Plan',
  pirate: 'Pirate Plan',
  astronaut: 'Astronaut Plan',
  pirate_astronaut: 'Pirate + Astronaut',
};

export interface Entitlements {
  proUnlocked: boolean;
  aiSubscribed: boolean;
  compassUnlocked: boolean;
  plan: UserPlan;
  /** 是否曾订阅过 Astronaut（用于区分首次/回归用户，回归用户显示 Upgrade 而非 Start free trial） */
  hadAstronautSubscription: boolean;
}

function computePlanFromProAndCompass(proUnlocked: boolean, compassUnlocked: boolean): UserPlan {
  return proUnlocked ? 'pirate_astronaut' : compassUnlocked ? 'pirate' : 'free';
}

function entitlementsFromLocal(
  pro: string | null,
  trialEnds: string | null,
  ai: string | null,
  compass: string | null,
  hadAstronaut = false
): Entitlements {
  const proPermanent = pro === 'true';
  const trialEnd = trialEnds ? new Date(trialEnds).getTime() : 0;
  const proTrialActive = trialEnd > Date.now();
  const proUnlocked = proPermanent || proTrialActive;
  const compassUnlocked = compass === 'true';
  return {
    proUnlocked,
    aiSubscribed: ai === 'true',
    compassUnlocked,
    plan: computePlanFromProAndCompass(proUnlocked, compassUnlocked),
    hadAstronautSubscription: hadAstronaut,
  };
}

const HAD_ASTRONAUT_KEY = 'lottopilot_had_astronaut_subscription';

export async function getEntitlements(): Promise<Entitlements> {
  const server = await fetchEntitlementsFromSupabase();
  if (server) {
    const proTrialEnd = server.pro_trial_ends ? new Date(server.pro_trial_ends).getTime() : 0;
    const proTrialActive = proTrialEnd > Date.now();
    const proUnlocked = server.pro_unlock || proTrialActive;
    const compassUnlocked = server.compass_unlock;
    const hadAstronautSubscription = server.had_astronaut_subscription;

    const ent: Entitlements = {
      proUnlocked,
      aiSubscribed: false,
      compassUnlocked,
      plan: computePlanFromProAndCompass(proUnlocked, compassUnlocked),
      hadAstronautSubscription,
    };
    await Promise.all([
      setItem(PRO_UNLOCK_KEY, proUnlocked ? 'true' : 'false'),
      setItem(PRO_TRIAL_ENDS_KEY, server.pro_trial_ends ?? ''),
      setItem(COMPASS_UNLOCK_KEY, compassUnlocked ? 'true' : 'false'),
      setItem(HAD_ASTRONAUT_KEY, hadAstronautSubscription ? 'true' : 'false'),
    ]);
    return ent;
  }

  const [pro, trialEnds, ai, compass, hadAstronaut] = await Promise.all([
    getItem(PRO_UNLOCK_KEY),
    getItem(PRO_TRIAL_ENDS_KEY),
    getItem(AI_SUB_KEY),
    getItem(COMPASS_UNLOCK_KEY),
    getItem(HAD_ASTRONAUT_KEY),
  ]);
  return entitlementsFromLocal(pro, trialEnds, ai, compass, hadAstronaut === 'true');
}

/** If email is admin, unlock all permissions. */
export async function claimAdminIfEligible(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(normalized)) return false;
  await Promise.all([setProUnlocked(true), setAiSubscribed(true), setCompassUnlocked(true)]);
  return true;
}

async function syncEntitlementsToSupabase(): Promise<void> {
  const [pro, trialEnds, compass, hadAstronaut] = await Promise.all([
    getItem(PRO_UNLOCK_KEY),
    getItem(PRO_TRIAL_ENDS_KEY),
    getItem(COMPASS_UNLOCK_KEY),
    getItem(HAD_ASTRONAUT_KEY),
  ]);
  await upsertEntitlementsToSupabase({
    compass_unlock: compass === 'true',
    pro_unlock: pro === 'true',
    pro_trial_ends: trialEnds || null,
    had_astronaut_subscription: hadAstronaut === 'true',
  });
}

/** 标记用户曾订阅过 Astronaut（购买成功后调用，用于回归用户显示 Upgrade） */
export async function setHadAstronautSubscription(): Promise<void> {
  await setItem(HAD_ASTRONAUT_KEY, 'true');
  await syncEntitlementsToSupabase();
}

/** 是否曾订阅过 Astronaut（回归用户用 base plan，无免费试用） */
export async function getHadAstronautSubscription(): Promise<boolean> {
  const ent = await getEntitlements();
  return ent.hadAstronautSubscription;
}

export async function setProUnlocked(value: boolean): Promise<void> {
  await setItem(PRO_UNLOCK_KEY, value ? 'true' : 'false');
  if (!value) await setItem(PRO_TRIAL_ENDS_KEY, '');
  await syncEntitlementsToSupabase();
}

/** Start 1-month Astronaut trial (for Pirate users). */
export async function setProTrialOneMonth(): Promise<void> {
  const ends = new Date();
  ends.setMonth(ends.getMonth() + 1);
  await setItem(PRO_TRIAL_ENDS_KEY, ends.toISOString());
  await syncEntitlementsToSupabase();
}

export async function setAiSubscribed(value: boolean): Promise<void> {
  await setItem(AI_SUB_KEY, value ? 'true' : 'false');
}

/** Check if AI features are available (aiSubscribed from entitlements). */
export async function canUseAIAsync(): Promise<boolean> {
  const ent = await getEntitlements();
  return ent.aiSubscribed;
}

/** Compass: Pirate plan OR Astronaut plan (Astronaut includes Pirate). */
export async function getCompassUnlocked(): Promise<boolean> {
  const [compass, pro] = await Promise.all([
    getItem(COMPASS_UNLOCK_KEY),
    getItem(PRO_UNLOCK_KEY),
  ]);
  return compass === 'true' || pro === 'true';
}

export async function setCompassUnlocked(value: boolean): Promise<void> {
  await setItem(COMPASS_UNLOCK_KEY, value ? 'true' : 'false');
  await syncEntitlementsToSupabase();
}

export async function getCompassUsedCount(): Promise<number> {
  const v = await getItem(COMPASS_USED_KEY);
  const n = parseInt(v ?? '0', 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

/** Returns { allowed, remaining, unlocked }. If allowed, caller should call tryConsumeCompassUse before proceeding. */
export async function checkCompassUsage(): Promise<{ allowed: boolean; remaining: number; unlocked: boolean }> {
  const unlocked = await getCompassUnlocked();
  if (unlocked) return { allowed: true, remaining: -1, unlocked: true };
  const used = await getCompassUsedCount();
  const remaining = Math.max(0, MAX_FREE_COMPASS_USES - used);
  return { allowed: remaining > 0, remaining, unlocked: false };
}

/** Consume 1 Compass use. Returns true if consumed, false if not allowed. */
export async function tryConsumeCompassUse(): Promise<boolean> {
  const { allowed, unlocked } = await checkCompassUsage();
  if (!allowed) return false;
  if (unlocked) return true;
  const used = await getCompassUsedCount();
  await setItem(COMPASS_USED_KEY, String(used + 1));
  return true;
}

/** 仅取消 Astronaut 订阅（清除 Pro），保留 Pirate 一次性购买的 Compass 权限。 */
export async function revokeAstronautSubscription(): Promise<void> {
  await setProUnlocked(false);
}

/** 登录后调用：将本地权益同步到 Supabase，避免购买时未登录导致服务端无记录 */
export async function syncLocalEntitlementsToServer(): Promise<void> {
  await syncEntitlementsToSupabase();
}

/** Clear all subscription/privilege state. Call on logout so next user or re-login starts as free. */
export async function clearEntitlementsOnLogout(): Promise<void> {
  await Promise.all([
    deleteItem(PRO_UNLOCK_KEY),
    deleteItem(HAD_ASTRONAUT_KEY),
    deleteItem(PRO_TRIAL_ENDS_KEY),
    deleteItem(AI_SUB_KEY),
    deleteItem(COMPASS_UNLOCK_KEY),
    setItem(COMPASS_USED_KEY, '0'),
  ]);
}
