# Scrape Lottery Draws - GitHub Actions 故障排查

## 必需配置

在 **GitHub 仓库** → **Settings** → **Secrets and variables** → **Actions** 中添加：

| Secret 名称 | 说明 |
|-------------|------|
| `SUPABASE_URL` | Supabase 项目 URL，如 `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key（Dashboard → Project Settings → API） |

## 常见失败原因

1. **Secrets 未配置**
   - 若缺失上述任一 secret，scraper 会因连接失败而报错
   - 在 Settings → Secrets 中确认已创建并填写

2. **Service Role Key 错误**
   - 必须使用 **service_role** key，不是 anon key
   - 在 Supabase Dashboard → Project Settings → API 中复制

3. **网络 / 源站问题**
   - Scraper 需要访问 WCLC、OLG 等官方站点
   - 若源站不可达或结构变化，可能导致失败

4. **npm ci 失败**
   - 需要有效的 `package-lock.json`
   - 本地执行 `npm install` 后提交 lock 文件

## 手动运行

在 **Actions** 标签中打开 “Scrape Lottery Draws”，点击 **Run workflow**。

## 查看日志

在 Actions 的 run 详情中查看失败步骤和具体报错，便于进一步排查。
