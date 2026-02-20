-- LottoPilot: North American Lottery Check + Analysis MVP
-- Data source: Official public lottery result pages only
-- Compliance: No ticket sales, no purchase, no prize distribution

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Lottery definitions (Canada + USA national lotteries)
CREATE TABLE lotteries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  draw_frequency TEXT NOT NULL, -- weekly, biweekly, etc.
  main_count INT NOT NULL,
  main_min INT NOT NULL,
  main_max INT NOT NULL,
  special_count INT NOT NULL,
  special_min INT,
  special_max INT,
  source_url TEXT NOT NULL,
  draw_schedule JSONB, -- e.g. {"days": ["tuesday", "friday"]}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Draw results (official winning numbers)
CREATE TABLE draws (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lottery_id TEXT NOT NULL REFERENCES lotteries(id),
  draw_date DATE NOT NULL,
  winning_numbers JSONB NOT NULL, -- [1,2,3,4,5,6]
  special_numbers JSONB, -- [7] or [5] for Powerball
  jackpot_cents BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lottery_id, draw_date)
);

CREATE INDEX idx_draws_lottery_date ON draws(lottery_id, draw_date DESC);

-- User tickets (synced when logged in; optional)
CREATE TABLE user_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id TEXT, -- client uuid for dedup
  lottery_id TEXT NOT NULL REFERENCES lotteries(id),
  draw_date DATE NOT NULL,
  user_numbers JSONB NOT NULL,
  user_special JSONB,
  winning_numbers JSONB,
  winning_special JSONB,
  match_count_main INT,
  match_count_special INT,
  result_bucket TEXT, -- no_win, small_hit, big_hit
  source TEXT DEFAULT 'manual', -- manual, photo
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_tickets_user ON user_tickets(user_id);
CREATE INDEX idx_user_tickets_checked ON user_tickets(checked_at DESC);

-- Entitlements (paid features)
CREATE TABLE entitlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  local_unlock BOOLEAN DEFAULT FALSE,
  ai_sub_active BOOLEAN DEFAULT FALSE,
  ai_trial_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Optional audit log (for compliance)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  action TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed lottery definitions
INSERT INTO lotteries (id, name, country, draw_frequency, main_count, main_min, main_max, special_count, special_min, special_max, source_url, draw_schedule) VALUES
('lotto_max', 'Lotto Max', 'CA', 'weekly', 7, 1, 49, 1, 1, 49, 'https://www.olg.ca/en/lottery/play-lotto-max-encore.html', '{"days":["tuesday","friday"]}'),
('lotto_649', 'Lotto 6/49', 'CA', 'weekly', 6, 1, 49, 1, 1, 49, 'https://www.olg.ca/en/lottery/play-lotto-649-encore.html', '{"days":["wednesday","saturday"]}'),
('powerball', 'Powerball', 'US', 'biweekly', 5, 1, 69, 1, 1, 26, 'https://www.powerball.com/', '{"days":["wednesday","saturday"]}'),
('mega_millions', 'Mega Millions', 'US', 'biweekly', 5, 1, 70, 1, 1, 25, 'https://www.megamillions.com/', '{"days":["tuesday","friday"]}');

-- RLS policies (optional: enable when auth ready)
ALTER TABLE lotteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE draws ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lotteries public read" ON lotteries FOR SELECT USING (true);
CREATE POLICY "Draws public read" ON draws FOR SELECT USING (true);
CREATE POLICY "User tickets own" ON user_tickets FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Entitlements own" ON entitlements FOR ALL USING (auth.uid() = user_id);
