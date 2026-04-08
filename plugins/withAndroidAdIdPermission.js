const {
  createRunOncePlugin,
  withAndroidManifest,
  AndroidConfig,
} = require('@expo/config-plugins');

const AD_ID = 'com.google.android.gms.permission.AD_ID';

function injectAdIdUsesPermission(androidManifest) {
  AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);
  const root = androidManifest.manifest;
  if (!Array.isArray(root['uses-permission'])) {
    root['uses-permission'] = [];
  }
  const perms = root['uses-permission'];
  const exists = perms.some((p) => p?.$?.['android:name'] === AD_ID);
  if (!exists) {
    perms.push({ $: { 'android:name': AD_ID } });
  }
}

function withAndroidAdIdPermissionImpl(config) {
  return withAndroidManifest(config, (config) => {
    injectAdIdUsesPermission(config.modResults);
    return config;
  });
}

/** Play: 控制台若声明使用广告 ID，合并后的 Manifest 须含此 uses-permission。 */
module.exports = createRunOncePlugin(
  withAndroidAdIdPermissionImpl,
  'with-android-ad-id-permission',
  '1.0.2',
);
