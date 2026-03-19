# EAS Secret 配置（Supabase 云端构建必做）

EAS 云端构建无法读取本地 `.env`，必须用 Secret 传入 Supabase 配置。

## 步骤

1. 打开 `.env`，复制 `EXPO_PUBLIC_SUPABASE_URL` 和 `EXPO_PUBLIC_SUPABASE_ANON_KEY` 的值

2. 在项目目录执行（把 `你的URL` 和 `你的KEY` 换成实际值）：

```bash
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://你的项目.supabase.co" --type string
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." --type string
```

3. 重新 build：

```bash
eas build --platform android --profile production
```

4. 上传到 Play 后测试 Supabase 是否正常

## 查看已有 Secret

```bash
eas secret:list
```

## 更新 Secret

```bash
eas secret:delete --name EXPO_PUBLIC_SUPABASE_URL
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "新值" --type string
```
