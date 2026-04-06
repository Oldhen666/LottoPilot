const { withPermissions } = require('@expo/config-plugins');

/** Forces AD_ID into merged manifest for Play (EAS prebuild; android/ may be gitignored). */
module.exports = function withAndroidAdIdPermission(config) {
  return withPermissions(config, ['com.google.android.gms.permission.AD_ID']);
}
