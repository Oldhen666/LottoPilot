/**
 * Web stub — AdMob is native-only. Keeps Metro web bundle from pulling native codegen.
 */
function mobileAds() {
  return {
    initialize: () => Promise.resolve(),
  };
}

const noop = () => {};
const noopPromise = () => Promise.resolve();
const noopUnsub = () => () => {};

module.exports = mobileAds;
module.exports.default = mobileAds;
module.exports.MobileAds = mobileAds;
module.exports.SDK_VERSION = '0-web';
module.exports.BannerAd = noop;
module.exports.BannerAdSize = { BANNER: 'BANNER', LARGE_ANCHORED_ADAPTIVE_BANNER: 'LARGE' };
module.exports.GAMBannerAdSize = {};
module.exports.useForeground = noop;
module.exports.RewardedAd = {
  createForAdRequest: () => ({
    load: noop,
    show: noopPromise,
    addAdEventListener: noopUnsub,
  }),
};
module.exports.RewardedAdEventType = { LOADED: 'LOADED', EARNED_REWARD: 'EARNED_REWARD' };
module.exports.AdEventType = { CLOSED: 'CLOSED', ERROR: 'ERROR' };
module.exports.TestIds = {};
module.exports.AppOpenAd = {};
module.exports.InterstitialAd = {};
module.exports.RewardedInterstitialAd = {};
module.exports.NativeAd = noop;
module.exports.NativeAdView = noop;
module.exports.NativeMediaView = noop;
module.exports.GAMBannerAd = noop;
module.exports.GAMInterstitialAd = {};
module.exports.AdsConsent = {};
module.exports.MaxAdContentRating = {};
module.exports.useAppOpenAd = noop;
module.exports.useInterstitialAd = noop;
module.exports.useRewardedAd = noop;
module.exports.useRewardedInterstitialAd = noop;
