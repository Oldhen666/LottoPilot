/**
 * Rewarded ad service abstraction for Compass Generate Picks.
 * Uses REWARDED_AD_UNIT_ID from adConfig.
 * Only grants access after FULL ad completion (EARNED_REWARD).
 */
import { Platform } from 'react-native';
import { REWARDED_AD_UNIT_ID } from '../config/adConfig';

const GATE_MESSAGE = 'Please watch the ad to continue generating picks.';
const AD_LOAD_FAILED_MESSAGE = 'Unable to load ad. Please check your internet connection and try again.';

export const REWARDED_AD_MESSAGES = {
  gateRequired: GATE_MESSAGE,
  adLoadFailed: AD_LOAD_FAILED_MESSAGE,
  modalTitle: 'Continue Generating',
  modalMessage: "You've reached 3 free generates. Upgrade to remove ads, or continue with the free plan.",
  upgradeToPiratePlan: 'Upgrade to Pirate Plan',
  keepFreePlan: 'Keep free plan',
} as const;

/** Lazy-load AdMob (not available on web) */
function getRewardedAdModule(): {
  RewardedAd: { createForAdRequest: (id: string) => { load: () => void; show: () => Promise<void>; addAdEventListener: (t: string, cb: (r?: unknown) => void) => () => void } };
  RewardedAdEventType: { LOADED: string; EARNED_REWARD: string };
  AdEventType: { CLOSED: string; ERROR: string };
} | null {
  if (Platform.OS === 'web') return null;
  try {
    return require('react-native-google-mobile-ads');
  } catch {
    return null;
  }
}

/**
 * Show rewarded ad for Generate Picks. Returns true only if user completed the full ad.
 * If user skips / closes early / ad fails → returns false.
 */
export async function showRewardedAdForGeneratePicks(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }

  const ads = getRewardedAdModule();
  if (!ads) {
    if (__DEV__) {
      console.log('[Ad] Rewarded Ad Loaded (simulated)', { unitId: REWARDED_AD_UNIT_ID });
      await new Promise((r) => setTimeout(r, 500));
      console.log('[Ad] Rewarded Ad Completed');
      return true;
    }
    return false;
  }

  const { RewardedAd, RewardedAdEventType, AdEventType } = ads;
  const rewarded = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID);

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const unsubs: (() => void)[] = [];

    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      unsubs.forEach((u) => u());
      resolve(result);
    };

    unsubs.push(
      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        console.log('[Ad] Rewarded Ad Loaded', { unitId: REWARDED_AD_UNIT_ID });
        rewarded
          .show()
          .then(() => {
            // Ad shown; wait for EARNED_REWARD or CLOSED
          })
          .catch((err: Error) => {
            console.warn('[Ad] Rewarded Ad Show Failed', err?.message);
            finish(false);
          });
      })
    );

    unsubs.push(
      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        console.log('[Ad] Rewarded Ad Completed');
        finish(true);
      })
    );

    unsubs.push(
      rewarded.addAdEventListener(AdEventType.CLOSED, () => {
        finish(false);
      })
    );

    unsubs.push(
      rewarded.addAdEventListener(AdEventType.ERROR, (error: unknown) => {
        console.warn('[Ad] Rewarded Ad Error', error);
        finish(false);
      })
    );

    rewarded.load();
  });
}
