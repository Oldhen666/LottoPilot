# LottoPilot - Deployment Guide

## Quick Start

### 1. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Run the migration:
   ```bash
   supabase db push
   # Or copy supabase/migrations/001_initial_schema.sql and run in SQL Editor
   ```
3. Seed initial draws (optional, for demo):
   ```bash
   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx npm run seed
   ```

### 2. Environment Variables

Create `.env` in project root (or use `expo-dev-client` env):

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. GitHub Actions - Automatic Draw Scraping

1. Fork/clone repo, add Secrets in GitHub repo Settings → Secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. Workflow runs daily at 3 AM UTC. Manual trigger: Actions → Scrape Lottery Draws → Run workflow.

### 4. Run App Locally

```bash
npm install
npm start
# Then: press 'a' for Android, 'i' for iOS, or scan QR with Expo Go
```

### 5. Build for Release

```bash
npx expo install expo-dev-client
npx eas build --platform android  # or ios
```

---

## App Store / Google Play Checklist

### Compliance
- [ ] App does NOT sell, purchase, or distribute lottery tickets
- [ ] No "prediction", "guarantee", "increase chances", "winning numbers" in UI/copy
- [ ] Short + long disclaimer visible in Settings
- [ ] Subscription page shows disclaimer

### Data & Privacy
- [ ] Privacy policy URL (required)
- [ ] Data source notice in Settings
- [ ] Local storage disclosure

### Technical
- [ ] IAP setup (StoreKit / Google Play Billing) for Paid1 & Paid2
- [ ] Replace MVP "tap to unlock" with real purchase flow
- [ ] RevenueCat (optional) for subscription management
