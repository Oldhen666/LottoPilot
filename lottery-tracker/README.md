# Lottery Results Tracker

Track lottery draw results for Lotto 6/49, Lotto Max, Powerball, and Mega Millions.

## Setup

### 1. Install

```bash
cd lottery-tracker
npm install
```

### 2. Environment

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TZ=America/Edmonton
```

### 3. Database

Run the SQL migrations in Supabase SQL Editor (in order):

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_rls.sql`

### 4. Run

**Dev server:**
```bash
npm run dev
```
Open http://localhost:3000

**Update script (fetch results):**
```bash
npm run update
```
Or: `npx tsx scripts/run-update.ts`

## Scheduled Run (Daily 00:00 Edmonton)

### Linux / macOS (crontab)

```bash
crontab -e
```

Add:
```
0 0 * * * cd /path/to/lottery-tracker && TZ=America/Edmonton npm run update >> /tmp/lottery-update.log 2>&1
```

### Windows Task Scheduler

1. Open **Task Scheduler** → Create Basic Task
2. Name: `Lottery Results Update`
3. Trigger: **Daily** at **12:00 AM**
4. Action: **Start a program**
   - Program: `node`
   - Arguments: `scripts/run-update.ts`
   - Start in: `C:\path\to\lottery-tracker`
5. Or use full path: `C:\path\to\lottery-tracker\node_modules\.bin\tsx.cmd` with args `scripts/run-update.ts`

## Project Structure

```
lottery-tracker/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # Dashboard
│   ├── lottery/[code]/page.tsx
│   └── errors/page.tsx
├── src/
│   ├── fetchers/             # Pluggable fetchers
│   │   ├── types.ts
│   │   ├── base.ts
│   │   ├── ca-649.ts
│   │   ├── ca-lottomax.ts
│   │   ├── us-powerball.ts
│   │   └── us-megamillions.ts
│   ├── lib/supabase.ts
│   └── components/NumberBalls.tsx
├── scripts/
│   └── run-update.ts
├── mocks/                    # Mock JSON for fetchers
└── supabase/migrations/
```

## No-draw Strategy

When yesterday is not a draw day for a lottery:
- `lottery_state` is **not updated** (latest_draw_date, etc. stay the same)
- `summary.no_draw` records the lottery code
- No `lottery_draws` row is written for that date
