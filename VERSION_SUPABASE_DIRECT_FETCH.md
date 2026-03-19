# 版本标记：Supabase 直接 REST 修复

**标记日期**: 2026-02-20

**版本说明**: 此版本修复了 Web 与移动端 "Network request failed" / 无限加载问题。

## 主要改动

1. **直接 REST 请求**：`fetchDraws` 改为使用直接 REST API 请求，绕过 Supabase 客户端（避免 auth/session 阻塞）
2. **Select 参数修复**：移除 PostgREST select 中的空格，修复 HTTP 400
3. **多客户端统一**：`addOnCatalog`、`prizeRules` 使用共享 `getSupabaseClient()`，消除 Multiple GoTrueClient 警告
4. **fetch-retry**：为 Supabase 请求添加重试逻辑
5. **调试清理**：已移除 index.ts 全局 fetch 日志，DEBUG_FETCH 设为 false

## 关键文件

- `src/services/supabase.ts` - fetchDrawsDirect、fetchDraws 逻辑
- `src/services/addOnCatalog.ts` - 使用 getSupabaseClient
- `src/services/prizeRules.ts` - 使用 getSupabaseClient
- `src/hooks/useDraws.ts` - 简化重试逻辑

## 回滚说明

若需回退到 Supabase 客户端方式，在 `fetchDraws` 中恢复使用 `fetchDrawsInner(getSupabase(), ...)` 并移除 `fetchDrawsDirect` 调用。
