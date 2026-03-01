# Jurisdiction & Prize Rules Upgrade

## 概述

本次升级为 LottoPilot 增加了**按区域（加拿大各省/美国各州）的奖金算法与兑奖规则**支持，使用户在对奖时可选择所在区域，并输出该区域对应的奖级与预计奖金。

## 合规与边界

- App 不卖彩票、不代购、不经手购票款、不分发奖金、不代表官方
- 奖金显示标注 "estimate / informational only"，并提供官方兑奖页面链接
- 对奖结果与奖级计算严格基于规则表（数据库驱动），不写死在代码里

## 1. 交付物清单

### 1.1 Supabase 数据库

- **迁移文件**: `supabase/migrations/002_jurisdiction_prize_rules.sql`
  - `jurisdictions` - 国家/省州
  - `lottery_games` - 彩票游戏
  - `prize_rule_sets` - 规则集（可版本化）
  - `prize_tiers` - 奖级表
  - `add_on_rules` - 附加玩法（Power Play / Megaplier）
  - 扩展 `draws` 表：jackpot_amount, multiplier_value
  - 扩展 `user_tickets` 表：jurisdiction_code, result_json

- **种子数据**: `supabase/seed/003_initial_prize_rules.sql`
  - 示例：Lotto Max / Lotto 6/49 (CA-ON), Powerball / Mega Millions (US-NATIONAL)

### 1.2 TypeScript 类型

- `src/types/jurisdiction.ts` - CurrentJurisdiction, PrizeTier, PrizeRuleSet, PrizeEngineOutput 等

### 1.3 定位与存储

- `src/services/location.ts` - 粗粒度定位、reverse geocoding、本地存储
- `src/constants/jurisdictions.ts` - CA 省 / US 州映射
- `src/hooks/useJurisdiction.ts` - 当前 jurisdiction 状态与手动覆盖

### 1.4 奖金引擎

- `src/services/prizeRules.ts` - 从 Supabase 加载规则
- `src/engine/prizeEngine.ts` - 纯函数：匹配 + 估算奖金

### 1.5 UI 更新

- **Settings**: 定位开关、手动覆盖区域、当前 jurisdiction 展示
- **Check Ticket**: 显示当前 jurisdiction，对奖时使用并保存
- **Result**: Match Summary、Prize Tier、Estimated Prize、Claim Info、Disclaimer
- **History**: 展示 game + jurisdiction + tier + prize_text

### 1.6 单元测试

- `src/engine/prizeEngine.test.ts` - 覆盖各 game 的命中/未命中场景

## 2. 使用说明

### 2.1 首次运行

1. 执行 Supabase 迁移：`supabase db push` 或手动运行 `002_jurisdiction_prize_rules.sql`
2. 执行种子：运行 `003_initial_prize_rules.sql`
3. 在 app.json 中已配置 expo-location 权限文案（需手动添加插件，见下方）

### 2.2 定位权限

在 `app.json` 的 `plugins` 中添加：

```json
["expo-location", {"locationWhenInUsePermission": "We use your location only to determine local lottery prize rules. Exact location is not stored."}]
```

### 2.3 无规则时的降级

- 若当前 lottery 在该 jurisdiction 下无规则集，显示 "Local prize rules unavailable. Showing national estimate."
- 使用 NATIONAL 或 DEFAULT rule_set 作为 fallback

## 3. 历史记录

- 历史 ticket 永远使用**保存时的 jurisdiction** 进行兑奖，不被后续定位覆盖
- `check_records` 新增 `jurisdiction_code`、`result_json` 字段
