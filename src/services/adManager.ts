/**
 * Centralized ad visibility control based on user plan.
 * - Banner ads: Free plan only; Pirate / Astronaut (incl. bundle) = hidden.
 * - Rewarded ads: only required for free plan; Pirate / Astronaut bypass.
 */
import type { UserPlan } from './entitlements';

/** Plans that bypass rewarded ad gate (no need to watch ads for Compass generate) */
const REWARDED_AD_FREE_PLANS: UserPlan[] = ['pirate', 'pirate_astronaut', 'astronaut'];

export function isAdFree(plan: UserPlan): boolean {
  return REWARDED_AD_FREE_PLANS.includes(plan);
}

/** Banner ads: show only when not on a paid ad-free plan. */
export function shouldShowBannerAds(plan: UserPlan): boolean {
  return !isAdFree(plan);
}

/** Rewarded ads: only for free plan; Pirate / Astronaut skip. */
export function shouldShowRewardedAds(plan: UserPlan): boolean {
  return !isAdFree(plan);
}

/**
 * Strategy Lab banners (sets / generate–refine gap / refine modal): only Astronaut access removes them.
 * Uses proUnlocked (paid Astronaut or active Astronaut free trial). Free-only Pirate / Compass Pirate still see these ads.
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
