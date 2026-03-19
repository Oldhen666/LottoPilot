# LottoPilot

North American official lottery ticket checker + analysis MVP.  
**Compliance-first**: No ticket sales, no purchase, no prize distribution. Check only.

## Structure

```
LottoPilot/
├── App.tsx                 # Entry, tabs, navigation
├── src/
│   ├── constants/
│   │   ├── lotteries.ts     # Lottery definitions (Lotto Max, 6/49, Powerball, Mega Millions)
│   │   └── disclaimers.ts   # Compliance copy
│   ├── db/
│   │   └── sqlite.ts        # Local SQLite (check history, stats)
│   ├── hooks/
│   │   └── useDraws.ts      # Fetch draws from Supabase
│   ├── screens/
│   │   ├── HomeScreen.tsx
│   │   ├── CheckTicketScreen.tsx
│   │   ├── ResultScreen.tsx
│   │   ├── StatsScreen.tsx
│   │   ├── InsightsScreen.tsx
│   │   ├── DrawsListScreen.tsx
│   │   └── SettingsScreen.tsx
│   ├── services/
│   │   ├── supabase.ts
│   │   └── ocr.ts           # Placeholder for OCR (iteration 2)
│   ├── types/
│   │   └── lottery.ts
│   └── utils/
│       └── check.ts         # Ticket checking logic
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── functions/
│       └── ai-analysis/    # Edge Function (rule-based insights)
├── scripts/
│   ├── scrape-draws.ts      # Fetch official results → Supabase
│   └── seed-draws.ts       # Demo seed
└── .github/workflows/
    └── scrape-draws.yml    # Cron: daily 3 AM UTC
```

## Run

```bash
npm install
# Add .env with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm start
```

扫码或按提示在模拟器/真机打开。底部 Tab：**Home | Compass | Strategy Lab | Settings**。  
**Compass 入口**：点击底部第二个 Tab「Compass」图标即可打开趋势罗盘。

## 数据更新（每日）

- **开奖数据**：`npm run scrape` 或 `npm run scrape:history`（全历史）
- **Compass 预计算**：scraper 完成后自动更新；也可单独运行 `npm run compass:update`
- **Draw History（开奖历史）**：已从 Supabase 拉取，随 scrape 更新

See [DEPLOY.md](./DEPLOY.md) for full deployment steps.
