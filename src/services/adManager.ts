/**
 * Centralized ad visibility control based on user plan.
 * - Compass ad-free: Pirate / Pirate+Astronaut (one-time Compass purchase).
 * - Strategy Lab ad-free: Astronaut only (see shouldShowStrategyLabBannerAds).
 */
import type { UserPlan } from './entitlements';

/** Plans with Compass unlimited + no Compass banner/rewarded ads */
const COMPASS_AD_FREE_PLANS: UserPlan[] = ['pirate', 'pirate_astronaut'];

export function isCompassAdFree(plan: UserPlan): boolean {
  return COMPASS_AD_FREE_PLANS.includes(plan);
}

/** @deprecated Use isCompassAdFree for Compass; Astronaut alone is not ad-free in Compass. */
export function isAdFree(plan: UserPlan): boolean {
  return isCompassAdFree(plan);
}

/** Banner ads on Compass / generic surfaces: hidden only for Pirate (or bundle). */
export function shouldShowBannerAds(plan: UserPlan): boolean {
  return !isCompassAdFree(plan);
}

/** Rewarded ads on Compass: Free and Astronaut-only users; Pirate skips. */
export function shouldShowRewardedAds(plan: UserPlan): boolean {
  return !isCompassAdFree(plan);
}

/**
 * Strategy Lab banners (sets / generate–refine gap / refine modal): only Astronaut access removes them.
 * Uses proUnlocked (Astronaut subscription or trial). Pirate-only users still see Strategy Lab ads.
 * `plan` kept for call-site consistency; visibility is proUnlocked-only.
 */
export function shouldShowStrategyLabBannerAds(_plan: UserPlan, proUnlocked: boolean): boolean {
  if (proUnlocked) return false;
  return true;
}

/** Settings bottom banner: only Free plan sees it; any paid tier removes it. */
export function shouldShowSettingsBannerAds(plan: UserPlan): boolean {
  return plan === 'free';
}
