/**
 * Banner ad component - real AdMob on native, placeholder on web.
 * Uses BANNER_AD_UNIT_ID from adConfig.
 * Pirate / Astronaut plans: hidden via shouldShowBannerAds (pass userPlan).
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, Platform, type ViewStyle } from 'react-native';
import { COLORS, SPACING } from '../constants/theme';
import { shouldShowBannerAds } from '../services/adManager';
import { BANNER_AD_UNIT_ID } from '../config/adConfig';
import type { UserPlan } from '../services/entitlements';

// AdMob does not support web - conditionally import for native only
const isNative = Platform.OS !== 'web';
let BannerAd: React.ComponentType<{
  unitId: string;
  size: string;
  onAdLoaded?: () => void;
  onAdFailedToLoad?: (error: Error) => void;
}> | null = null;
let BannerAdSize: { LARGE_ANCHORED_ADAPTIVE_BANNER: string } | null = null;
let useForeground: (callback: () => void) => void = () => {};

if (isNative) {
  try {
    const ads = require('react-native-google-mobile-ads');
    BannerAd = ads.BannerAd;
    BannerAdSize = ads.BannerAdSize;
    useForeground = ads.useForeground ?? (() => {});
  } catch {
    // Fallback if module unavailable (e.g. dev without native build)
  }
}

/** Adaptive height for placeholder (web) */
function getAdaptiveBannerHeight(width: number): number {
  const base = Math.round(width / 6.4);
  return Math.max(50, Math.min(90, base));
}

interface Props {
  testId?: string;
  userPlan?: UserPlan;
  /** When set, overrides adManager.shouldShowBannerAds(userPlan). */
  shouldShowBanner?: boolean;
  /** Merged onto outer ad container (e.g. marginVertical: 0 above tab bar) */
  containerStyle?: ViewStyle;
}

function PlaceholderView({ testId, containerStyle }: { testId?: string; containerStyle?: ViewStyle }) {
  const { width } = useWindowDimensions();
  const adHeight = getAdaptiveBannerHeight(width);
  return (
    <View style={[styles.container, { height: adHeight }, containerStyle]}>
      <View style={styles.inner}>
        <Text style={styles.label}>{testId ? `Ad slot ${testId}` : 'Ad'}</Text>
        {__DEV__ && (
          <Text style={styles.devHint}>Use expo run:android/ios for real test ads</Text>
        )}
      </View>
    </View>
  );
}

function NativeBannerAd({ testId, containerStyle }: { testId?: string; containerStyle?: ViewStyle }) {
  const bannerRef = useRef<{ load?: () => void } | null>(null);

  useForeground(() => {
    if (Platform.OS === 'ios' && typeof bannerRef.current?.load === 'function') {
      bannerRef.current.load();
    }
  });

  if (!BannerAd || !BannerAdSize) {
    return <PlaceholderView testId={testId} containerStyle={containerStyle} />;
  }

  return (
    <View style={[styles.container, containerStyle]}>
      <BannerAd
        ref={bannerRef as React.RefObject<{ load: () => void }>}
        unitId={BANNER_AD_UNIT_ID}
        size={BannerAdSize.BANNER}
        onAdLoaded={() => {
          console.log('[Ad] Banner Ad Loaded', { testId, unitId: BANNER_AD_UNIT_ID });
        }}
        onAdFailedToLoad={(error: Error) => {
          console.warn('[Ad] Banner Ad Failed', { testId, error: error?.message });
        }}
      />
    </View>
  );
}

export function BannerAdPlaceholder({ testId, userPlan, shouldShowBanner, containerStyle }: Props) {
  const visible =
    shouldShowBanner !== undefined ? shouldShowBanner : userPlan === undefined || shouldShowBannerAds(userPlan);
  if (!visible) {
    return null;
  }

  if (!isNative || !BannerAd) {
    return <PlaceholderView testId={testId} containerStyle={containerStyle} />;
  }

  return <NativeBannerAd testId={testId} containerStyle={containerStyle} />;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginVertical: SPACING.screenPadding / 2,
    backgroundColor: COLORS.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  devHint: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 4,
    opacity: 0.8,
  },
});
