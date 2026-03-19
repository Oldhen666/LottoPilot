# Network Request Failed 排查指南

当 App 显示 "Network request failed" 或 "Unable to connect to Supabase" 时，按以下顺序排查。

---

## 1. Supabase 项目是否已暂停（最常见）

**免费版 Supabase 项目在 7 天无活动后会自动暂停。**

### 检查与恢复

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard)
2. 选择你的项目
3. 若看到 **"Project paused"** 或 **"Restore project"**，说明项目已暂停
4. 点击 **Restore project**，等待几分钟
5. 恢复完成后，在 App 中下拉刷新或重新打开

---

## 2. 网络环境

- **WiFi**：尝试切换 WiFi 或使用手机热点
- **VPN**：关闭 VPN 后重试
- **公司/学校网络**：可能屏蔽 `supabase.co`，换手机流量测试
- **手机流量**：确认有网络，可先打开网页测试

---

## 3. 在浏览器中测试 Supabase 是否可达

在手机或电脑浏览器中访问：

```
https://zldrnfulssvwsbjdttpg.supabase.co/rest/v1/
```

- 若返回 JSON（如 `{"message":"..."}`）或 401，说明 Supabase 可访问
- 若无法打开或超时，说明网络或 Supabase 有问题

---

## 4. 确认 draws 表有数据

1. Supabase Dashboard → **Table Editor** → **draws**
2. 确认有数据，且 `lottery_id` 包含 `lotto_max`、`lotto_649` 等

---

## 5. 确认 RLS 策略

1. Supabase Dashboard → **Authentication** → **Policies**
2. 找到 `draws` 表
3. 若需要未登录也能读，需有允许 `anon` 或 `public` 的 SELECT 策略

---

## 6. 开发环境测试

在项目根目录执行：

```bash
npx expo start
```

用 Expo Go 或模拟器测试。若开发环境正常而正式包失败，可能是打包或环境变量问题。
