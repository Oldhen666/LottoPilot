-- LottoPilot: Add-on games (EXTRA, ENCORE, TAG, Power Play, Double Play, Maxmillions, Gold Ball, Mega Multiplier)
-- Data-driven: catalog defines which add-ons appear per game+jurisdiction

-- A) add_on_catalog
CREATE TABLE IF NOT EXISTS add_on_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_code TEXT NOT NULL,
  jurisdiction_code TEXT NOT NULL,
  add_on_code TEXT NOT NULL,
  add_on_type TEXT NOT NULL CHECK (add_on_type IN ('INDEPENDENT_NUMBER', 'INDEPENDENT_DRAW', 'MULTIPLIER', 'BUILT_IN_COMPONENT')),
  input_schema_json JSONB,
  rules_schema_json JSONB,
  official_rules_url TEXT,
  claim_url TEXT,
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_code, jurisdiction_code, add_on_code)
);

CREATE INDEX idx_add_on_catalog_lookup ON add_on_catalog(game_code, jurisdiction_code, is_enabled);

-- B) draws table extensions
ALTER TABLE draws ADD COLUMN IF NOT EXISTS maxmillions_numbers_json JSONB;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS extra_number TEXT;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS encore_number TEXT;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS tag_number TEXT;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS power_play_multiplier INT;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS double_play_numbers_json JSONB;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS mega_multiplier INT;

-- C) user_tickets extensions (Supabase)
ALTER TABLE user_tickets ADD COLUMN IF NOT EXISTS add_ons_inputs_json JSONB;

-- RLS
ALTER TABLE add_on_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Add on catalog public read" ON add_on_catalog FOR SELECT USING (true);
