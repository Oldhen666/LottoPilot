/**
 * Expo app config - loads .env and passes to app via extra.
 * Uses Node fs only (no dotenv package) so EAS / expo config works when node_modules is incomplete.
 */
const fs = require('fs');
const path = require('path');

(function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
})();

module.exports = {
  expo: {
    name: 'LottoPilot',
    slug: 'LottoPilot',
    scheme: 'lottopilot',
    version: '1.0.7',
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
      versionCode: 37,
      permissions: ['com.android.vending.BILLING', 'com.google.android.gms.permission.AD_ID'],
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
    runtimeVersion: '1.0.7',
    plugins: [
      [
        'react-native-google-mobile-ads',
        {
          /** LottoPilot Android — AdMob app (Play). */
          androidAppId: 'ca-app-pub-1778212368956758~9185292273',
          /** Replace when you add an iOS app in AdMob; until then Google sample avoids iOS native init issues in dev. */
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
      './plugins/withAndroidAdIdPermission.js',
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
