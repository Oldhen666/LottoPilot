# Email 确认 + Deep Link 自动登录

开启 Supabase **Confirm email** 后，用户点击邮件中的确认链接会跳回 App 并自动登录。

## 手机浏览器空白页问题

若直接使用 `lottopilot://auth/callback` 作为跳转地址，部分手机邮箱/浏览器无法处理自定义 scheme，会显示空白页。**解决方案**：使用 HTTPS 中间跳转页，先打开网页再跳转到 App。

## 已实现逻辑

1. **app.config.js**：`scheme: 'lottopilot'`，用于 Deep Link
2. **signUp**：注册时传入 `emailRedirectTo`：
   - 配置了 `EXPO_PUBLIC_AUTH_CALLBACK_URL`（HTTPS）时，使用该地址（推荐）
   - 否则使用 `lottopilot://auth/callback`
3. **privacy-policy-site/auth/callback/**：中间跳转页，接收 Supabase 重定向后立即跳转到 `lottopilot://auth/callback#...`
4. **App.tsx**：监听 Deep Link，收到 `lottopilot://auth/callback#access_token=...` 时解析 token 并调用 `setSession`，然后重置导航到主界面

## 配置步骤

### 1. 部署中间跳转页

将 `privacy-policy-site/` 部署到 GitHub Pages（或任意静态托管），确保可访问：

```
https://你的用户名.github.io/lottopilot-privacy/auth/callback/
```

### 2. 配置 .env

在 `.env` 中添加：

```
EXPO_PUBLIC_AUTH_CALLBACK_URL=https://你的用户名.github.io/lottopilot-privacy/auth/callback
```

### 3. Supabase Dashboard

1. 打开 [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/_/auth/url-configuration)
2. **Site URL** 设为：`https://你的用户名.github.io/lottopilot-privacy/auth/callback`
3. 在 **Redirect URLs** 中添加：
   - `https://你的用户名.github.io/lottopilot-privacy/auth/callback`
   - `lottopilot://auth/callback`

### 4. 重新 Build

修改了 env 和 scheme，需要重新 build：

```bash
eas build --platform android
```

## 流程说明

1. 用户注册 → Supabase 发送确认邮件
2. 用户点击邮件中的链接 → 打开 **HTTPS 中间页**（如 `https://xxx.github.io/.../auth/callback/#access_token=...`）
3. 中间页加载后立即执行 `window.location = 'lottopilot://auth/callback' + hash`
4. 系统打开 App，App 收到 Deep Link，解析 token 并 `setSession`
5. 登录成功，导航回到主界面
