# Phase 2: ALC TAG 完成报告

## 1) DB Schema / Seed 完整性

### Schema (Supabase)
- **004_alc_tag.sql**：新增 `lotteries` 条目 `alc_tag`（Atlantic TAG, nightly）
- **draws 表**：`alc_tag` 使用 `lottery_id='alc_tag'`，`tag_number` 存 6 位开奖号，`winning_numbers=[]`
- **add_on_catalog**：TAG 已更新为 6 位（`digits:6`），CA-NB、CA-NS

### 本地 SQLite
- 无变更（TAG 结果存于 `result_json.addOnResults.TAG`）

---

## 2) 真实开奖对奖验证示例

### 数据来源
- **lottoresult.ca**：Atlantic Tag 与主玩法同 draw date（Lotto Max / Lotto 6/49 详情页）
- 示例：2025-12-05 Lotto Max → Atlantic Tag: **335939**
- 示例：2025-12-06 Lotto 6/49 → Atlantic Tag: **228018**

### 验证步骤
1. 执行迁移并抓取：
   ```bash
   supabase db push   # 或执行 004_alc_tag.sql
   npm run scrape
   ```
2. 在 App 中：
   - 选择 **Lotto Max** 或 **Lotto 6/49**
   - Jurisdiction: **CA-NB** 或 **CA-NS**
   - 选择 draw date: **2025-12-05**（Lotto Max）或 **2025-12-06**（6/49）
   - 勾选 **TAG**，输入 6 位数字：`335939` 或 `228018`
   - 点击 Check Results

### 预期结果
- **TAG 区块**：Your: 335939 • Winning: 335939 • 6 digits matched • Jackpot

---

## 3) Result UI 展示说明

### 关联展示（不强绑主 draw）
- TAG 结果来自独立 `alc_tag` draw，按 `TAG_DRAW_DATE`（默认主 draw 日期）查询
- 当用户勾选 TAG 且 `alc_tag` 有对应日期数据时，显示 TAG 区块

### Add-on Results 区块
```
┌─────────────────────────────────────┐
│ TAG                                 │
│ Your: 335939 • Winning: 335939     │
│ 6 digits matched • Jackpot          │
└─────────────────────────────────────┘
```

### Companion Game 建模
- `lottery_id='alc_tag'` 独立存储 nightly 结果
- 主玩法（lotto_max / lotto_649）与 TAG 通过 `draw_date` 关联
- `add_ons_inputs_json.TAG_DRAW_DATE` 可选，默认与主 draw 同日期
