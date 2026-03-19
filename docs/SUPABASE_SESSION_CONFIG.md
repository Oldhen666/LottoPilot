# Supabase Session 配置（低频使用场景）

LottoPilot 用户可能几周才打开一次 App。为减少频繁重新登录，建议在 Supabase 中适当配置 Session 策略。

> **说明**：以下配置在 Supabase Dashboard 中完成，**不会增加成本**，仅为策略设置。

---

## 操作步骤

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard)，选择你的项目
2. 左侧菜单点击 **Authentication** → **Settings** → **Sessions**
3. 按下方「推荐设置」修改并保存

---

## 推荐设置

| 设置项 | 建议值 | 说明 |
|--------|--------|------|
| **JWT expiry** | `3600`（1 小时） | Access token 过期时间，App 会自动用 refresh token 续期 |
| **Refresh token rotation** | 开启 | 提高安全性 |
| **Refresh token reuse interval** | `10` | 秒，防止并发刷新冲突 |
| **Inactivity timeout** | 关闭 | 关闭后用户几周不用也不会被强制登出 |
| **Time-box** | 关闭 | 同上；若必须开启，建议 ≥ 90 天（7776000 秒） |

### 如何关闭 Inactivity timeout / Time-box

- 找到对应开关，设为 **Off** 或 **Disabled**
- 若界面为输入框，可清空或设为 `0`（具体以 Dashboard 为准）

---

## 默认行为

- Supabase 默认 **refresh token 永不过期**（除非被 revoke 或用户登出）
- 只要 refresh token 有效，App 在启动或从后台恢复时会自动调用 `refreshSession` 续期 access token
- 若启用了 **Inactivity timeout** 或 **Time-box**，长时间未使用的 session 会被视为过期，用户需重新登录

---

## 升级/隔夜后 Supabase 不可用

若出现「隔夜后再打开全都不行」，已通过以下逻辑自动恢复：

- **App 激活时刷新 session**：从后台恢复或启动时调用 `refreshSession`，JWT 约 1 小时过期，需主动刷新
- **auth 错误时清空并重试**：401/JWT 无效时清空 auth、重置 client
- **启动时尽早触发 draws 刷新**：300ms 后触发一次，init 完成后再触发一次

---

## 相关代码

- `src/services/supabase.ts`：`validateSessionOnStartup`、`tryRefreshSession`、`resetSupabaseAndClearStorage`
- `src/utils/storageVersionCheck.ts`：`runEarlyStorageVersionCheck`（版本变更时清空 auth）
