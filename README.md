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
│   │   ├── HistoryScreen.tsx
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

See [DEPLOY.md](./DEPLOY.md) for full deployment steps.
