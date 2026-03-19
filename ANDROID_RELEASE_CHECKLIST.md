# LottoPilot Android 上架清单

## 一、账号与资质

| 项目 | 说明 |
|------|------|
| **Google Play 开发者账号** | 一次性 $25 注册费，需 Google 账号 |
| **身份验证** | 个人或企业，需提供真实姓名、地址、支付方式 |

---

## 二、技术准备

### 1. EAS Build 配置

项目暂无 `eas.json`，需创建：

```bash
npx eas-cli login   # 登录 Expo 账号
npx eas build:configure   # 生成 eas.json
```

或手动创建 `eas.json`：

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal", "android": { "buildType": "apk" } },
    "production": { "android": { "buildType": "app-bundle" } }
  },
  "submit": {
    "production": { "android": { "serviceAccountKeyPath": "./google-service-account.json" } }
  }
}
```

### 2. 环境变量（EAS Build 必配）

**重要**：EAS Build 在云端运行，无法读取本地 `.env`。必须在 EAS 中创建 Secret：

```bash
# 从 .env 复制值，然后执行：
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://你的项目.supabase.co" --type string
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "eyJ..." --type string
```

本地开发仍使用 `.env`；EAS Build 会使用上述 Secret。

### 3. app.json 检查

- [ ] `version` 已设置（当前 1.0.0）
- [ ] `package` 已设置（当前 com.oldhen666.LottoPilot）
- [ ] `android.permissions` 中 `RECORD_AUDIO` 重复，建议只保留一次
- [ ] 确认 targetSdkVersion 满足 Google 要求（Expo 54 默认应满足）

### 4. 构建命令

```bash
npx eas build --platform android --profile production
```

---

## 三、测试清单

### 必测功能

| 功能 | 测试项 |
|------|--------|
| **Check Ticket** | 选彩票 → 输入号码 → 查看结果 |
| **Compass** | 加载趋势 → 选号 → 生成 |
| **Strategy Lab** | 策略集切换 → Generate Picks → Refine |
| **Settings** | 登录/登出 → 订阅升级 → 地区覆盖 |
| **离线** | 断网后核心功能是否可用 |
| **多机型** | 至少 2 台不同 Android 设备（不同分辨率） |

### 兼容性

- [ ] Android 8.0+（Expo 默认支持）
- [ ] 竖屏、横屏（如支持）
- [ ] 不同屏幕尺寸（手机、平板）

---

## 四、Google Play 所需材料

### 1. 应用信息

| 材料 | 规格 |
|------|------|
| **应用名称** | LottoPilot |
| **简短描述** | 80 字符以内 |
| **完整描述** | 4000 字符以内，说明功能、免责声明 |
| **应用图标** | 512×512 PNG，32 位 |
| **Feature Graphic** | 1024×500 PNG，商店横幅 |
| **手机截图** | 至少 2 张，建议 4–8 张，16:9 或 9:16 |

### 2. 隐私与合规

| 材料 | 说明 |
|------|------|
| **隐私政策 URL** | 必须可公开访问，说明数据收集与使用 |
| **Data safety 表单** | 在 Play Console 填写：是否收集数据、类型、用途 |
| **内容分级** | 完成问卷（通常为 3+ 或 7+） |

### 3. 彩票类应用特别注意

- [ ] 明确说明：不销售、不购买、不发放彩票
- [ ] 无“预测”“保证中奖”“提高中奖率”等表述
- [ ] Settings 中免责声明可见
- [ ] 订阅/付费页面有免责说明

---

## 五、发布流程

1. **构建**：`npx eas build --platform android --profile production`
2. **下载 AAB**：从 EAS 构建页面下载
3. **创建应用**：Play Console → 创建应用 → 填写基本信息
4. **上传 AAB**：发布 → 生产环境 → 创建版本 → 上传 AAB
5. **填写商店信息**：截图、描述、隐私政策、Data safety 等
6. **提交审核**：提交以供审核，通常 1–3 天

---

## 六、可选优化

- [ ] **应用内购买**：若需 Pirate/Astronaut 付费，接入 Google Play Billing
- [ ] **崩溃监控**：接入 Sentry 或 Firebase Crashlytics
- [ ] **分析**：Firebase Analytics 或类似工具
- [ ] **应用签名**：使用 EAS 自动管理，或自行配置 Play App Signing

---

## 七、快速检查命令

```bash
# 检查配置
npx expo config --type public

# 本地构建测试（可选）
npx expo run:android --variant release
```
