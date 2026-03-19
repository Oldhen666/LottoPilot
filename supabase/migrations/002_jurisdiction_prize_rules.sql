-- LottoPilot: Jurisdiction & Prize Rules (Canada provinces / US states)
-- Compliance: Rules are database-driven; no hardcoded prize logic

-- A) jurisdictions
CREATE TABLE IF NOT EXISTS jurisdictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  country TEXT NOT NULL CHECK (country IN ('CA', 'US')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('CAD', 'USD')),
  timezone TEXT DEFAULT 'America/Toronto',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(country, code)
);

CREATE INDEX idx_jurisdictions_country ON jurisdictions(country);

-- B) lottery_games (extend or create; maps to existing lotteries)
CREATE TABLE IF NOT EXISTS lottery_games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  number_rules_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- C) prize_rule_sets (versioned rule sets per game + jurisdiction)
CREATE TABLE IF NOT EXISTS prize_rule_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_code TEXT NOT NULL,
  jurisdiction_code TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  effective_from DATE NOT NULL,
  effective_to DATE,
  notes TEXT,
  official_rules_url TEXT,
  claim_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prize_rule_sets_lookup ON prize_rule_sets(game_code, jurisdiction_code, is_active);
CREATE INDEX idx_prize_rule_sets_effective ON prize_rule_sets(effective_from, effective_to);

-- D) prize_tiers (match conditions -> prize type/amount)
CREATE TABLE IF NOT EXISTS prize_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_set_id UUID NOT NULL REFERENCES prize_rule_sets(id) ON DELETE CASCADE,
  tier_name TEXT NOT NULL,
  match_main INT NOT NULL,
  match_special INT,
  match_bonus INT,
  prize_type TEXT NOT NULL CHECK (prize_type IN ('FIXED', 'PARI_MUTUEL', 'MULTIPLIER', 'FREE_PLAY', 'OTHER')),
  prize_amount NUMERIC,
  prize_currency TEXT CHECK (prize_currency IN ('CAD', 'USD')),
  multiplier_applicable BOOLEAN DEFAULT false,
  min_prize NUMERIC,
  max_prize NUMERIC,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prize_tiers_rule_set ON prize_tiers(rule_set_id);
CREATE INDEX idx_prize_tiers_match ON prize_tiers(rule_set_id, match_main, match_special);

-- E) add_on_rules (Power Play, Megaplier, Extra, MaxMillions, etc.)
CREATE TABLE IF NOT EXISTS add_on_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_set_id UUID NOT NULL REFERENCES prize_rule_sets(id) ON DELETE CASCADE,
  add_on_code TEXT NOT NULL,
  add_on_type TEXT NOT NULL CHECK (add_on_type IN ('INDEPENDENT_DRAW', 'MULTIPLIER', 'OTHER')),
  config_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_add_on_rules_rule_set ON add_on_rules(rule_set_id);

-- F) Extend draws table (add columns if not exist)
ALTER TABLE draws ADD COLUMN IF NOT EXISTS jackpot_amount NUMERIC;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS multiplier_value NUMERIC;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS bonus_numbers JSONB;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS jurisdiction_scope TEXT DEFAULT 'NATIONAL';

-- Note: draws.lottery_id maps to game_code (lotto_max, lotto_649, powerball, mega_millions)

-- G) Extend user_tickets / check_records: jurisdiction_code, result_json
-- Supabase user_tickets:
ALTER TABLE user_tickets ADD COLUMN IF NOT EXISTS jurisdiction_code TEXT;
ALTER TABLE user_tickets ADD COLUMN IF NOT EXISTS add_ons_selected_json JSONB;
ALTER TABLE user_tickets ADD COLUMN IF NOT EXISTS result_json JSONB;

-- RLS for new tables
ALTER TABLE jurisdictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lottery_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE prize_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE prize_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE add_on_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Jurisdictions public read" ON jurisdictions FOR SELECT USING (true);
CREATE POLICY "Lottery games public read" ON lottery_games FOR SELECT USING (true);
CREATE POLICY "Prize rule sets public read" ON prize_rule_sets FOR SELECT USING (true);
CREATE POLICY "Prize tiers public read" ON prize_tiers FOR SELECT USING (true);
CREATE POLICY "Add on rules public read" ON add_on_rules FOR SELECT USING (true);
