/**
 * Centralized ad visibility control based on user plan.
 * Pirate / Pirate+Astronaut = ad-free (no banners, rewarded, or interstitial).
 */
import type { UserPlan } from './entitlements';

/** Plans that get ad-free experience: no ads at all */
const AD_FREE_PLANS: UserPlan[] = ['pirate', 'pirate_astronaut'];

export function isAdFree(plan: UserPlan): boolean {
  return AD_FREE_PLANS.includes(plan);
}

export function shouldShowBannerAds(plan: UserPlan): boolean {
  return !isAdFree(plan);
}

export function shouldShowRewardedAds(plan: UserPlan): boolean {
  return !isAdFree(plan);
}
