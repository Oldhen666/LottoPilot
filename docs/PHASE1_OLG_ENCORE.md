# Phase 1: OLG ENCORE 完成报告

## 1) DB Schema / Seed 完整性

### Schema (Supabase)
- **draws 表**：已有 `encore_number TEXT`（003_add_ons.sql）
- **add_on_catalog**：已有 OLG ENCORE 条目（004_add_on_catalog.sql）
  - `lotto_max` + `CA-ON` → ENCORE
  - `lotto_649` + `CA-ON` → ENCORE

### 前置条件
若 Supabase 报错 `Could not find the 'encore_number' column`，请执行迁移：
```bash
supabase db push
# 或手动执行 supabase/migrations/003_add_ons.sql
```

### 本地 SQLite
- `check_records` 表已有 `add_ons_selected_json`、`add_ons_inputs_json`（src/db/sqlite.ts schema v3）

---

## 2) 真实开奖对奖验证示例

### 数据来源
- **lottoresult.ca**：Ontario Encore 与主玩法同 draw date
- 示例：2025-12-05 Lotto Max → Ontario Encore: **8850544**
- 示例：2025-12-06 Lotto 6/49 → Ontario Encore: **9541839**

### 验证步骤
1. 运行抓取（需先执行 DB 迁移）：
   ```bash
   npm run scrape
   ```
2. 或手动 seed ENCORE（当 draw 已存在时）：
   ```bash
   npx ts-node --project scripts/tsconfig.json scripts/seed-encore-draw.ts
   ```
3. 在 App 中：
   - 选择 **Lotto Max** 或 **Lotto 6/49**
   - Jurisdiction: **CA-ON**（Ontario）
   - 选择 draw date: **2025-12-05**（Lotto Max）或 **2025-12-06**（6/49）
   - 勾选 **ENCORE**，输入 7 位数字：`8850544`（Lotto Max）或 `9541839`（6/49）
   - 主玩法号码可随意（仅验证 ENCORE）
   - 点击 Check Results

### 预期结果
- **ENCORE 区块**：Your: 8850544 • Winning: 8850544 • 7 digits matched • Jackpot
- 或 Your: 9541839 • Winning: 9541839 • 7 digits matched • Jackpot

### 部分匹配示例
- 用户输入 `8850540`，开奖 `8850544` → 右对齐 5 位匹配 → $10

---

## 3) Result UI 展示说明

### Add-on Results 区块
当 `result_json.addOnResults.ENCORE` 存在时，ResultScreen 显示：

```
┌─────────────────────────────────────┐
│ ADD-ON RESULTS                      │
├─────────────────────────────────────┤
│ ENCORE                              │
│ Your: 8850544 • Winning: 8850544   │
│ 7 digits matched • Jackpot          │
└─────────────────────────────────────┘
```

### CheckTicketScreen 输入
- Jurisdiction = CA-ON 时，`add_on_catalog` 返回 ENCORE
- 勾选 ENCORE + 7 位数字输入框
- 保存时写入 `add_ons_selected_json`、`add_ons_inputs_json`

### 规则驱动
- `add_on_catalog.rules_schema_json`：`matchDirection: "rightToLeft"`，`tiers` 定义奖级
- 对奖引擎使用右对齐匹配（与 EXTRA 相同逻辑）
