import Constants from 'expo-constants';

/**
 * Powerball 扫描诊断 bundle（文件 + summary）开关。
 *
 * —— 本地开发：__DEV__ 为 true 时恒为开，无需配置。
 *
 * —— EAS Update（方案 A）常见「发了 update 仍看不到诊断区」原因：
 * 1) 云端打包拿不到你电脑上的 .env（.env 在 .gitignore，不会上传 EAS）。
 * 2) 只跑了 `eas update --channel production`（或 preview），没有带 `--environment`。
 *    官方要求：update 必须用 `eas update --environment <名>`，且 **channel 与 environment 要和你的包一致**
 *    （发 production 渠道 → `--channel production --environment production`），才会把 Expo 后台里
 *    **同名环境**下的 EXPO_PUBLIC_* 打进本次 JS bundle。
 * 3) 未在 Expo 后台（或 `eas env:create`）为 **production**（或 preview）创建
 *    `EXPO_PUBLIC_POWERBALL_SCAN_DIAGNOSTIC=1`。
 *
 * 正确流程示例（发 **production** 渠道时）：
 *   eas env:create --name EXPO_PUBLIC_POWERBALL_SCAN_DIAGNOSTIC --value 1 --environment production --visibility plaintext
 *   npm run update:production
 * （preview 渠道则把上面 environment 与 channel 改成 preview，并 `npm run update:preview`。）
 *
 * 与最后一次 eas build 时嵌入的 app.config extra.powerballScanDiagnostic 无关时，以 **OTA 本次打进 bundle 的**
 * process.env.EXPO_PUBLIC_* 为准（见 isPowerballScanDiagnosticEnabled 内联判断）。
 */
export function isPowerballScanDiagnosticEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  const extra = Constants.expoConfig?.extra as { powerballScanDiagnostic?: boolean } | undefined;
  if (extra?.powerballScanDiagnostic === true) return true;
  return process.env.EXPO_PUBLIC_POWERBALL_SCAN_DIAGNOSTIC === '1';
}
