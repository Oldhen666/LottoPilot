/**
 * Banner ad component - real AdMob on native, placeholder on web.
 * Uses BANNER_AD_UNIT_ID from adConfig.
 * Pirate plan users: no ads (returns null).
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { COLORS, SPACING } from '../constants/theme';
import { isAdFree } from '../services/adManager';
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
}

function PlaceholderView({ testId }: { testId?: string }) {
  const { width } = useWindowDimensions();
  const adHeight = getAdaptiveBannerHeight(width);
  return (
    <View style={[styles.container, { height: adHeight }]}>
      <View style={styles.inner}>
        <Text style={styles.label}>{testId ? `Ad slot ${testId}` : 'Ad'}</Text>
        {__DEV__ && (
          <Text style={styles.devHint}>Use expo run:android/ios for real test ads</Text>
        )}
      </View>
    </View>
  );
}

function NativeBannerAd({ testId }: { testId?: string }) {
  const bannerRef = useRef<{ load?: () => void } | null>(null);

  useForeground(() => {
    if (Platform.OS === 'ios' && typeof bannerRef.current?.load === 'function') {
      bannerRef.current.load();
    }
  });

  if (!BannerAd || !BannerAdSize) {
    return <PlaceholderView testId={testId} />;
  }

  return (
    <View style={styles.container}>
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

export function BannerAdPlaceholder({ testId, userPlan }: Props) {
  if (userPlan !== undefined && isAdFree(userPlan)) {
    return null;
  }

  if (!isNative || !BannerAd) {
    return <PlaceholderView testId={testId} />;
  }

  return <NativeBannerAd testId={testId} />;
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
