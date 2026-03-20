# Supabase 直接 REST 修复说明

## 问题现象

- **Latest Draw**：无限加载或 "Network request failed"
- **Trends (Compass)**：卡住
- **Account sign in**：登录时卡住
- **Settings / Entitlements**：加载订阅状态时卡住

## 根本原因

Supabase 客户端 (`createClient`) 在 Web 和部分移动端环境下，**在发起任何 HTTP 请求之前**就会被 auth/session 初始化阻塞。表现为：

1. 调用 `supabase.from('draws').select()` 时，代码能执行到 `fetchDrawsInner start`
2. 但**没有任何 fetch 请求发出**（控制台无 `[FETCH-GLOBAL]`）
3. 请求一直挂起，直到超时

因此问题不在网络，而在 **Supabase 客户端在请求前的内部逻辑**（如 GoTrueClient、session 恢复等）阻塞了执行。

## 修复思路：直接 REST 绕过客户端

不通过 Supabase 客户端，改用 **原生 fetch** 直接请求 Supabase REST API：

```
https://{project}.supabase.co/rest/v1/{table}?{query}
Headers: apikey, Accept, (可选) Authorization
```

这样完全绕过 Supabase 客户端的 auth 初始化，请求能正常发出。

## Latest Draw 的修复步骤

### 1. 添加 `fetchDrawsDirect`

```typescript
async function fetchDrawsDirect(lotteryId: string, limit: number): Promise<Draw[]> {
  const { url, key } = getSupabaseConfig();
  const restUrl = `${url}/rest/v1/draws?lottery_id=eq.${lotteryId}&order=draw_date.desc&limit=${limit}&select=${encodeURIComponent(select)}`;
  const res = await fetch(restUrl, {
    headers: { apikey: key, Accept: 'application/json' },
  });
  const rows = await res.json();
  return rows.map(...);
}
```

### 2. PostgREST select 参数

- **不能有空格**：`id, lottery_id` 会报 HTTP 400，需改为 `id,lottery_id`
- **列不存在时**：先用 FULL 列，400 时回退到 MIN 列

### 3. 替换 `fetchDraws`

将 `fetchDraws` 改为直接调用 `fetchDrawsDirect`，不再使用 `supabase.from('draws').select()`。

## 其他功能的同类修复

| 功能 | 修复方式 |
|------|----------|
| **Compass / Trends** | `fetchDrawsForCompass` 已用 `fetchDrawsDirect` |
| **fetchCompassSnapshot** | 已用直接 REST |
| **fetchDrawByDate** | 已用直接 REST |
| **addOnCatalog / prizeRules** | 已用 `fetchAddOnCatalogDirect` / `loadRuleSetDirect` |
| **Entitlements** | `getSessionFromStorage` 读 session + `fetchEntitlementsDirect` |
| **Sign in** | `signInDirect` 调用 `/auth/v1/token?grant_type=password` |
| **getCurrentUserEmail** | 优先 `getSessionFromStorage`，避免触发客户端 |

## 关键点总结

1. **直接 REST**：对公开表或已知 URL 的请求，用 `fetch` + `apikey` 头，不经过 `createClient`
2. **Session 从 storage 读**：`getSessionFromStorage` 解析 `sb-*-auth-token`，获取 `userId`、`accessToken`，用于需要 RLS 的请求
3. **Auth 直接调用**：`signInDirect` 调 `/auth/v1/token`，成功后写入 storage，并 `notifyAuthStateChange()`
4. **onAuthStateChange**：先执行一次 `run()`（用 storage），再尝试订阅客户端；客户端创建失败时仍能工作

## 回滚

若需恢复使用 Supabase 客户端，在 `fetchDraws`、`fetchEntitlementsFromSupabase`、`signIn` 等处去掉 direct 分支，改回 `getSupabase()` 调用。
