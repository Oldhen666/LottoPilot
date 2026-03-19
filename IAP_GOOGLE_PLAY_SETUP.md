# Google Play 内购接入清单

## 一、你现在需要做的事（按顺序）

### 1. Google Play Console 准备

| 步骤 | 操作 |
|------|------|
| 1.1 | 登录 [Google Play Console](https://play.google.com/console) |
| 1.2 | 选择应用 LottoPilot（或先创建应用） |
| 1.3 | 左侧菜单 → **获利** → **产品** → **应用内商品** |
| 1.4 | 创建 **一次性商品**：`lottopilot_pirate`，价格 $1.99 |
| 1.5 | 创建 **订阅**：`lottopilot_astronaut_monthly`，价格 $0.99/月 |
| 1.6 | 保存并**激活**商品（状态需为「有效」） |

### 2. 应用必须已上传至少一个版本

- 内购商品只有在应用有**已发布或内部测试版本**时才能完成购买测试
- 若尚未发布：先上传到**内部测试**轨道，添加测试邮箱，用该账号安装后测试购买

### 3. 测试账号

| 项目 | 说明 |
|------|------|
| **许可证测试** | Play Console → 设置 → 许可证测试 → 添加测试 Gmail |
| **测试购买** | 用测试账号登录设备，购买不会扣真实款项（可多次测试） |

---

## 二、项目内已完成的代码准备

- [x] 安装 `react-native-iap`
- [x] 添加 config plugin 到 `app.config.js`
- [x] 创建 `src/services/iap.ts` 封装购买逻辑
- [x] Settings 页面接入 IAP（Android 真机/模拟器使用真实购买，Web 保持 tap-to-unlock）

---

## 三、商品 ID 与代码对应

| 商品 | Play Console 中填写的 Product ID | 用途 |
|------|----------------------------------|------|
| Pirate Plan | `lottopilot_pirate` | 一次性 $1.99 |
| Astronaut Plan | `lottopilot_astronaut_monthly` | 订阅 $0.99/月 |

**重要**：Play Console 中创建的商品 ID 必须与代码中 `IAP_PRODUCT_IDS` 完全一致。

---

## 四、构建与测试

```bash
# 1. 安装依赖后重新 prebuild（因添加了 native 模块）
npx expo prebuild --clean

# 2. 构建 Android 版本
npx eas build --platform android --profile preview
# 或 production: npx eas build --platform android --profile production

# 3. 安装到设备后，用许可证测试账号登录，测试购买流程
```

---

## 五、常见问题

| 问题 | 处理 |
|------|------|
| 购买时提示「商品不可用」 | 检查商品 ID 是否一致、商品是否已激活、应用是否已上传版本 |
| 测试购买扣款 | 确认已加入许可证测试名单 |
| Web 无法购买 | 正常，Web 仍使用 tap-to-unlock，仅 Android 使用真实 IAP |
| 订阅续费/取消 | 用户需在 Google Play 订阅管理中操作，应用内可调用 `deepLinkToSubscriptions()` 跳转 |

---

## 六、收款流程（简要）

1. 用户在应用内完成购买 → Google 处理支付
2. 约 15–30% 佣金，剩余 70–85% 进入你的 Google Play 收入
3. 在 Play Console 绑定银行账户和税务信息
4. 每月结算，款项打入你的银行账户
