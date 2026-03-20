/**
 * Expo app config - loads .env and passes to app via extra.
 * This ensures Supabase credentials are available even when process.env is not.
 */
require('dotenv').config();

module.exports = {
  expo: {
    name: 'LottoPilot',
    slug: 'LottoPilot',
    scheme: 'lottopilot',
    version: '1.0.3',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0c1629',
    },
    ios: { supportsTablet: true },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0c1629',
      },
      package: 'com.oldhen666.LottoPilot',
      versionCode: 24,
      permissions: ['com.android.vending.BILLING'],
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.RECORD_AUDIO',
    ],
    web: { favicon: './assets/favicon.png' },
    updates: {
      url: 'https://u.expo.dev/2ae23643-f627-4cfc-9214-764502ce4849',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    plugins: [
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: 'ca-app-pub-3940256099942544~3347511713',
          iosAppId: 'ca-app-pub-3940256099942544~1458002511',
        },
      ],
      'react-native-iap',
      ['expo-image-picker', {
        photosPermission: 'Allow LottoPilot to access your photos to scan lottery tickets',
        cameraPermission: 'Allow LottoPilot to use your camera to scan lottery tickets',
      }],
      ['react-native-document-scanner-plugin', {
        cameraPermission: 'Allow LottoPilot to scan lottery tickets (flattens angled photos)',
      }],
    ],
    extra: {
      eas: {
        projectId: '2ae23643-f627-4cfc-9214-764502ce4849',
      },
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
      authCallbackUrl: process.env.EXPO_PUBLIC_AUTH_CALLBACK_URL || '',
    },
  },
};
