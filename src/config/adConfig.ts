/**
 * Centralized AdMob ad unit configuration.
 * Use test IDs for development; switch to production IDs when isTestMode = false.
 * https://developers.google.com/admob/android/test-ads
 */
import { Platform } from 'react-native';

/** When true, use Google test ad unit IDs. Set to false for production store builds. */
export const AD_TEST_MODE = false;
/** Alias for AD_TEST_MODE - set to false when switching to production IDs */
export const isTestMode = AD_TEST_MODE;

/** Google test ad unit IDs - platform-specific for best compatibility */
const TEST_BANNER_ANDROID = 'ca-app-pub-3940256099942544/6300978111'; // Fixed size 320x50
const TEST_BANNER_IOS = 'ca-app-pub-3940256099942544/2934735716'; // Fixed size 320x50
const TEST_ADAPTIVE_BANNER_ANDROID = 'ca-app-pub-3940256099942544/9214589741';
const TEST_ADAPTIVE_BANNER_IOS = 'ca-app-pub-3940256099942544/2435281174';
const TEST_REWARDED_ANDROID = 'ca-app-pub-3940256099942544/5224354917';
const TEST_REWARDED_IOS = 'ca-app-pub-3940256099942544/1712485313';

/** Production ad units (LottoPilot — AdMob). */
const PROD_BANNER_ID = 'ca-app-pub-1778212368956758/8629539919';
const PROD_REWARDED_ID = 'ca-app-pub-1778212368956758/5400741345';

/** Banner: fixed 320x50 - use with BannerAdSize.BANNER */
export const BANNER_AD_UNIT_ID = AD_TEST_MODE
  ? Platform.select({ android: TEST_BANNER_ANDROID, ios: TEST_BANNER_IOS, default: TEST_BANNER_ANDROID })
  : PROD_BANNER_ID;

/** Adaptive banner - use with BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER */
export const ADAPTIVE_BANNER_AD_UNIT_ID = AD_TEST_MODE
  ? Platform.select({ android: TEST_ADAPTIVE_BANNER_ANDROID, ios: TEST_ADAPTIVE_BANNER_IOS, default: TEST_ADAPTIVE_BANNER_ANDROID })
  : PROD_BANNER_ID;

export const REWARDED_AD_UNIT_ID = AD_TEST_MODE
  ? Platform.select({ android: TEST_REWARDED_ANDROID, ios: TEST_REWARDED_IOS, default: TEST_REWARDED_ANDROID })
  : PROD_REWARDED_ID;
