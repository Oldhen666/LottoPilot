# EAS Update 时 Supabase 加载不出来 - 配置指南

## 问题原因

`eas update`（OTA 更新）在 **EAS 云端** 构建 JavaScript bundle，**不会使用你本地的 `.env` 文件**。  
如果 Supabase 的 URL 和 Key 没有配置到 EAS，构建时 `process.env.EXPO_PUBLIC_SUPABASE_*` 会是空的，导致应用里 Supabase 无法连接。

---

## 解决步骤

### 1. 在 EAS 中创建/更新环境变量

> 注意：`eas secret:create` 已废弃，请使用 `eas env:create`。

**若变量已存在**（需修改值）：

```bash
eas env:update --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://你的项目.supabase.co" --visibility plaintext
eas env:update --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "你的anon-key" --visibility plaintext
```

**若变量不存在**（新建）：

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://你的项目.supabase.co" --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "你的anon-key" --environment production --visibility plaintext
```

### 2. 在 Expo 网页中检查/编辑

1. 打开 [expo.dev](https://expo.dev) → 你的项目 → **Environment variables**
2. 确认 `EXPO_PUBLIC_SUPABASE_URL` 和 `EXPO_PUBLIC_SUPABASE_ANON_KEY` 的值正确
3. 若值不对，可直接在网页上编辑

### 3. 确保 eas.json 使用对应 environment

在 `eas.json` 的 build 配置中加上 `environment`（若没有）：

```json
"production": {
  "channel": "production",
  "environment": "production",
  "android": { "buildType": "app-bundle" }
}
```

### 4. 发布 Update 时指定 environment

```bash
eas update --channel production --environment production
```

或你实际使用的 channel（如 `preview`）。

### 5. 验证

- 完全退出应用后重新打开
- 检查 Latest Draw 是否能正常加载

---

## 获取 Supabase 配置

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard)
2. 选择项目 → **Settings** → **API**
3. 复制 **Project URL** 和 **anon public** key

---

## 常见问题

**Q: 变量是 SECRET 类型，update 后还是不加载？**  
A: **SECRET 类型的变量不会被包含进 eas update 的 bundle**，只有 plaintext 或 sensitive 才会。需要删除后重建为 plaintext：

```bash
# 1. 删除（在 expo.dev 网页上操作更简单，或逐个 environment 删除）
eas env:delete production --variable-name EXPO_PUBLIC_SUPABASE_URL
eas env:delete production --variable-name EXPO_PUBLIC_SUPABASE_ANON_KEY

# 2. 用 plaintext 重新创建
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://你的项目.supabase.co" --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "你的anon-key" --environment production --visibility plaintext

# 3. 重新发布
eas update --channel production --environment production
```

若变量在 preview、development 也存在，需对每个 environment 执行 delete。

**Q: 提示 "This project already has an environment variable named EXPO_PUBLIC_SUPABASE_URL"？**  
A: 变量已存在，用 `eas env:update` 更新值，或在 [expo.dev](https://expo.dev) 项目设置中直接编辑。

**Q: 我已经配置了本地 .env，为什么 OTA 后还是加载不出来？**  
A: OTA 在云端构建，不会读取本地 .env。必须用 `eas env:create` 把配置存到 EAS，且 `eas update` 要加 `--environment production`。

**Q: 创建/更新变量后需要重新 build 吗？**  
A: 不需要。只需重新执行 `eas update --environment production`，新的 bundle 会带上这些 env。
