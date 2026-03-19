# Google Play 内购接入清单

## 一、你现在需要做的事（按顺序）

### 1. Google Play Console 准备

| 步骤 | 操作 |
|------|------|
| 1.1 | 注册 [Google Play 开发者账号](https://play.google.com/console)（$25 一次性） |
| 1.2 | 创建应用（若尚未创建），包名使用 `com.oldhen666.LottoPilot` |
| 1.3 | 完成应用基础信息：商店列表、隐私政策、内容分级等 |
| 1.4 | 进入 **获利** → **产品** → **应用内商品** |

### 2. 先上传包含 BILLING 的 APK/AAB

Play Console 要求：**必须先上传至少一个包含 BILLING 权限的版本**，才能创建内购商品。

| 步骤 | 操作 |
|------|------|
| 2.1 | 本地构建：`npx expo prebuild --clean` 后 `npx expo run:android`，或使用 EAS Build |
| 2.2 | 在 Play Console → **发布** → **内部测试**（或测试轨道）→ 点击「创建新版本」 |
| 2.3 | 上传生成的 AAB（通常在 `android/app/build/outputs/bundle/`） |
| 2.4 | 保存并提交审核（内部测试可快速通过） |

项目已配置 `com.android.vending.BILLING` 权限（见 `app.config.js` → `android.permissions`）。

### 3. 在 Play Console 创建商品

上传版本后，进入 **Monetize with Play** → **Products**：

| 商品类型 | 商品 ID | 价格 | 说明 |
|----------|---------|------|------|
| **一次性** | `lottopilot_pirate` | $3.95 CAD / $3.49 USD | Pirate Plan |
| **订阅** | `lottopilot_astronaut_monthly` | $0.99 CAD/月 / $0.99 USD/月 | Astronaut Plan |

- **Pirate**：One-time products → Create product → 商品 ID 填 `lottopilot_pirate` → 定价 $1.99
- **Astronaut**：Subscriptions → Create subscription → 商品 ID 填 `lottopilot_astronaut_monthly` → 定价 $0.99/月

### 4. 测试账号（可选但推荐）

- Play Console → **设置** → **许可测试** → 添加测试邮箱
- 测试账号可在正式上架前完成购买，且不会真实扣款

### 5. 项目内技术步骤（见下方「二、技术接入」）

---

## 二、技术接入（项目内已完成/待完成）

### 已具备

- `src/services/iap.ts`：内购服务封装（`purchasePirate`、`purchaseAstronaut`、`restoreIAPPurchases`）
- 商品 ID 常量：`lottopilot_pirate`、`lottopilot_astronaut_monthly`

### 待完成

1. **安装依赖**：`npx expo install react-native-iap`
2. **添加插件**：在 `app.config.js` 的 `plugins` 中加入 `"react-native-iap"`
3. **重新构建**：`npx expo prebuild --clean` 后 `npx expo run:android`
4. **应用启动时**：调用 `initIAP()` 和 `setupPurchaseListeners()`
5. **升级按钮**：改为调用 `purchasePirate()` / `purchaseAstronaut()`，而非直接解锁
6. **恢复购买**：在 Settings 增加「恢复购买」按钮，调用 `restoreIAPPurchases()`

---

## 三、收款与结算

| 项目 | 说明 |
|------|------|
| **谁收款** | Google 代收，再结算给你 |
| **结算周期** | 通常每月一次，达到最低金额后打款 |
| **佣金** | Google 约 15%（首年后）或 30% |
| **收款方式** | Play Console → 设置 → 付款资料 → 绑定银行账户 |
| **税务** | 需在 Play Console 填写税务信息（W-9 等） |

---

## 四、用户 Plan 的存储与控制（谁在管？）

| 层级 | 负责方 | 作用 |
|------|--------|------|
| **支付与收据** | **Google Play** | 实际扣款、保存购买记录。用户「恢复购买」时，应用向 Google 查询已有购买。 |
| **权益状态（本机）** | **SecureStore / localStorage** | 购买成功后，应用调用 `setCompassUnlocked(true)` 或 `setProUnlocked(true)`，把权益存到本机。重启或换设备后，需通过「恢复购买」从 Google 拉取并重新写入。 |
| **Supabase** | **不参与 Plan 控制** | 目前只做：登录、Draw 数据、可选记录同步。Plan 权益不存 Supabase，也不由 Supabase 控制。 |

**流程简述：**
1. 用户购买 → Google Play 扣款并返回收据  
2. `iap.ts` 的 `handlePurchase` 收到回调 → 调用 `setCompassUnlocked` / `setProUnlocked`  
3. 权益写入本机 SecureStore（或 Web 的 localStorage）  
4. `entitlements.ts` 的 `getEntitlements()` 读取本机状态 → 决定 UI 显示的 plan（free / pirate / astronaut）

**未来扩展：** 若要做跨设备同步，可将购买记录同步到 Supabase（与用户账号绑定），当前实现暂未使用。

---

## 五、注意事项

1. **内购仅支持真机**：Web 和 Expo Go 不支持，需用 development build 或 production build
2. **商品审核**：新建商品需审核，通常与应用审核一起进行
3. **测试**：先用许可测试账号在内部测试轨道验证购买流程
4. **订阅取消**：用户需在 Google Play 订阅管理中取消，应用内「Cancel subscription」仅清除本地权益
5. **购买前 Sign in**：未登录时点击升级，会提示「Sign in first」并引导到登录页，以便跨设备同步购买
