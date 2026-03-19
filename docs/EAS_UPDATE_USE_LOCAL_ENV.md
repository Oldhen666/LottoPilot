# 用本地 .env 发布 EAS Update（推荐，绕过 EAS 环境变量）

EAS 环境变量容易出问题，**推荐用本地 `.env` 发布**。

## 原理

- `eas update` 在**本地**执行
- **不**加 `--environment` 时，会使用本地 `.env` 中的 `EXPO_PUBLIC_*` 变量
- 这些值会被打包进 bundle，不依赖 EAS 配置

## 步骤

### 1. 确认 .env 正确

在项目根目录 `LottoPilot` 的 `.env` 中确保：

```
EXPO_PUBLIC_SUPABASE_URL=https://zldrnfulssvwsbjdttpg.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=从 Supabase Dashboard 复制的 anon key
```

**重要**：anon key 必须来自项目 `zldrnfulssvwsbjdttpg`（Supabase → Settings → API → anon public）

### 2. 发布 Update（不要加 --environment）

```bash
eas update --channel production
```

**不要**使用 `--environment production`，否则会用 EAS 变量覆盖本地 `.env`。

### 3. 验证

- 完全退出应用后重新打开
- 等待几秒让 OTA 生效
- 检查 Latest Draw 是否能正常加载

## 注意

- `.env` 不要提交到 git（若包含敏感信息）
- 本机需有正确的 `.env` 才能发布
- 若用 CI/CD 发布，需在 CI 中配置这些环境变量
