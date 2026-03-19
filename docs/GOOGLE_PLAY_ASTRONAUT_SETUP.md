# Google Play Astronaut 订阅配置指南

本文档说明如何在 Google Play Console 中配置 Astronaut 订阅，以实现以下业务逻辑：

1. **首次用户**：1 个月免费试用，可随时取消，试用期内保持访问
2. **试用到期**：不取消则自动开始收费
3. **取消后**：权益维持到当前计费周期结束，然后失效
4. **回归用户**：重新订阅需走付费流程，无免费试用，按钮显示 "Upgrade to Astronaut plan"

---

## 一、Google Play Console 配置

### 1. 创建订阅商品

1. 登录 [Google Play Console](https://play.google.com/console)
2. 选择应用 → **Monetize** → **Products** → **Subscriptions**
3. 点击 **Create subscription**
4. **Product ID**：`lottopilot_astronaut_monthly`（必须与代码中一致）

### 2. 配置 Base Plan（基础月付计划）

1. 在订阅详情中，添加 **Base plan**
2. **Base plan ID**：例如 `monthly`
3. **Billing period**：1 month（每月）
4. **Renewal type**：Auto-renewing（自动续订）
5. **Price**：设置各地区价格（如 $0.99/月）
6. **Resubscribe**：开启，允许过期用户重新订阅

### 3. 配置 Free Trial Offer（免费试用）

1. 在 Base plan 下添加 **Offer**
2. **Offer ID**：例如 `free-trial`
3. **Eligibility**：选择 **New customer acquisition**
   - 即：仅从未订阅过该商品的用户可见
   - Google 会自动限制：已取消/过期的用户无法再次享受
4. **Offer phases**：
   - Phase 1：**Free trial**，1 month（1 个月免费）
   - 试用结束后自动按 Base plan 价格续费

### 4. 取消与计费周期

- **用户取消**：在 Google Play 订阅管理中取消，权益维持到当前周期结束
- **试用期内取消**：同样维持到试用结束，不会扣费
- **试用结束不取消**：自动扣费并续订

---

## 二、App 端逻辑（已实现）

| 场景 | 按钮文案 | 购买流程 |
|------|----------|----------|
| 首次用户 | Start 1-month free trial | 使用 free trial offer token |
| 回归用户（曾订阅过） | Upgrade to Astronaut plan | 使用 base plan（无 offer） |

- **had_astronaut_subscription**：存储在 Supabase `entitlements` 表，购买成功后设为 `true`，永不回退
- 回归用户通过 `getHadAstronautSubscription()` 判断，使用 `{ skus: [sku] }` 发起购买，不传 offer token

---

## 三、后台监控（可选）

### 1. Google Play Real-time Developer Notifications (RTDN)

用于接收订阅状态变更（续订、取消、过期等）：

1. 在 Google Play Console → **Monetize** → **Monetization setup** 中配置 **Real-time developer notifications**
2. 提供 HTTPS 回调 URL（需部署后端服务）
3. 收到通知后，根据 `subscriptionNotification` 更新 Supabase `entitlements` 表

### 2. 定期清理未计费用户

- 可通过 Google Play Developer API 的 `purchases.subscriptions` 接口校验订阅状态
- 或依赖 RTDN 推送，在收到 `SUBSCRIPTION_EXPIRED` / `SUBSCRIPTION_CANCELED` 时更新 `pro_unlock = false`

### 3. Supabase 表结构

```sql
-- entitlements 表相关列
pro_unlock BOOLEAN          -- 当前是否有 Astronaut 权益
pro_trial_ends TIMESTAMPTZ  -- 试用结束时间（可选）
had_astronaut_subscription BOOLEAN  -- 是否曾订阅过（用于回归用户判断）
```

---

## 四、验证清单

- [ ] 订阅商品 ID 为 `lottopilot_astronaut_monthly`
- [ ] Base plan 为月付、自动续订
- [ ] Free trial offer 的 Eligibility 为 "New customer acquisition"
- [ ] 免费试用时长为 1 个月
- [ ] Resubscribe 已开启
- [ ] 应用内首次用户显示 "Start 1-month free trial"
- [ ] 回归用户显示 "Upgrade to Astronaut plan"，且购买时无免费试用
