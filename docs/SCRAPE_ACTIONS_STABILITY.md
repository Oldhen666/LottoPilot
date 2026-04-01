# GitHub Actions Scrape 稳定性说明

## 数据源优先级 (Lotto Max / Lotto 649)

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | **lottoresult.ca** | 主力，多期历史；GitHub Actions IP 可能被拦截 |
| 2 | **WCLC (官方)** | 西加拿大彩票；数据中心 IP 常被封 |
| 3 | **lotterycanada.com** | 兜底，仅最新 1 期；解析 JSON-LD + 数字表格 |

## 已实施的改进

### 1. 请求重试与 User-Agent 轮换
- **lottoresult.ca** 请求在 403/503 或网络错误时自动重试（最多 3 次）
- 每次重试使用不同的浏览器 User-Agent，降低单一 UA 被封的概率
- 单次请求超时 30 秒，重试间隔 5 秒

### 2. 每日双次运行
- **03:00 UTC** 和 **15:00 UTC** 各运行一次
- 若某次因 lottoresult.ca 临时封禁导致失败，另一次可能成功
- `concurrency` 防止两次运行重叠

### 3. 统一 lottoresult.ca 请求
- Lotto Max、Lotto 649、OLG ENCORE、ALC TAG 的 lottoresult.ca 请求均走 `fetchLottoResult`
- 享受统一的重试、超时、UA 轮换

## 若 Actions 仍不稳定

1. **本地 monitor 备选**：运行 `npm run monitor`，定期检查并在需要时手动执行 `u` 更新
2. **自托管 Runner**：在家庭网络或 VPS 上配置 GitHub Self-hosted Runner，使用非数据中心 IP
3. **其他平台**：将 scrape 迁至 Vercel Cron、Railway 等，IP 可能未被 lottoresult.ca 封禁
