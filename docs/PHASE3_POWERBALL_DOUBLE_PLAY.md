# Phase 3: Powerball Double Play 完成报告

## 1) 数据源确认

### NY Open Data (data.ny.gov)
- **Powerball 数据集**：`d6yy-54nr` 提供 `draw_date`, `winning_numbers`, `multiplier`
- **Double Play**：**不包含**。NY Open Data 仅提供主玩法 + Power Play multiplier

### 潜在数据源（待验证）
- **powerball.com**：`/draw-result?gc=pb-double-play&date=YYYY-MM-DD` 有 Double Play 结果
- Double Play 仅在部分州提供（CO, CT, DC, FL, IN, 等），NY 需单独确认

---

## 2) 已实现内容

### Catalog
- `add_on_catalog` 已有 DOUBLE_PLAY（powerball + US-NATIONAL, US-NY, US-CA）
- `input_schema_json`: `{"userCheckbox":true}`
- `rules_schema_json`: `{"matchLogic":"sameAsMain"}`

### Handler (addOnEngine)
- `computeDoublePlayResult(userMain, userSpecial, doublePlayNumbers)`：复用主玩法匹配逻辑
- `computeAddOnResults`：当用户勾选 DOUBLE_PLAY 时：
  - 有 `double_play_numbers_json` → 正常对奖
  - 无数据 → 返回占位：`prizeText: "Double Play data not available for this draw. Check powerball.com."`

### UI
- **CheckTicketScreen**：DOUBLE_PLAY 勾选框（jurisdiction 为 US 时显示）
- **ResultScreen**：DOUBLE_PLAY 区块，显示 match_main + match_special + prizeText

### 抓取
- **占位**：scrape-draws.ts 中已注释说明 NY Open Data 无 Double Play
- **抓取可延后**：待找到稳定数据源后，在 Powerball 抓取逻辑中增加 `double_play_numbers` 解析与写入

---

## 3) 验证示例（有数据时）

当 `draws.double_play_numbers_json` 有值（如 `[14, 32, 47, 48, 69, 17]`）时：
- 用户主号 [14, 32, 47, 48, 69]，特别号 [17]
- 结果：5 main + 1 PB → Jackpot

---

## 4) 优雅降级

- 用户勾选 DOUBLE_PLAY 但该期无数据 → 显示 "Double Play data not available for this draw. Check powerball.com."
- 主玩法及其他 add-on 不受影响
