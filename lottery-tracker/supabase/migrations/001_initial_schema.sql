-- Lottery Results Tracker - Initial Schema
-- Run in Supabase SQL Editor or via supabase db push

-- (1) lotteries: lottery definitions
CREATE TABLE IF NOT EXISTS lotteries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('CA', 'US')),
  draw_days JSONB NOT NULL DEFAULT '[]',
  has_addons JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lotteries_code ON lotteries(code);
CREATE INDEX idx_lotteries_region ON lotteries(region);

-- (2) lottery_draws: each draw result
CREATE TABLE IF NOT EXISTS lottery_draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lottery_code TEXT NOT NULL REFERENCES lotteries(code) ON DELETE CASCADE,
  draw_date DATE NOT NULL,
  draw_id TEXT,
  numbers_json JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'unknown',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'no_draw', 'partial', 'error')),
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lottery_code, draw_date)
);

CREATE INDEX idx_lottery_draws_lottery_date ON lottery_draws(lottery_code, draw_date DESC);
CREATE INDEX idx_lottery_draws_draw_date ON lottery_draws(draw_date DESC);

-- (3) lottery_state: latest state per lottery (for fast UI)
CREATE TABLE IF NOT EXISTS lottery_state (
  lottery_code TEXT PRIMARY KEY REFERENCES lotteries(code) ON DELETE CASCADE,
  latest_draw_date DATE,
  latest_numbers_json JSONB,
  latest_status TEXT CHECK (latest_status IN ('ok', 'no_draw', 'partial', 'error')),
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_error_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (4) job_runs: daily job execution log
CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL DEFAULT 'daily_results_update',
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  summary_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_runs_started ON job_runs(started_at DESC);

-- (5) job_errors: error details
CREATE TABLE IF NOT EXISTS job_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  lottery_code TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('fetch', 'parse', 'db_upsert', 'validate')),
  message TEXT NOT NULL,
  error_stack TEXT,
  context_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_errors_run ON job_errors(run_id);
CREATE INDEX idx_job_errors_lottery ON job_errors(lottery_code);
CREATE INDEX idx_job_errors_created ON job_errors(created_at DESC);

-- Seed lotteries
INSERT INTO lotteries (code, name, region, draw_days, has_addons) VALUES
  ('CA_649', 'Lotto 6/49', 'CA', '["WED","SAT"]', '{"encore": true}'),
  ('CA_LOTTOMAX', 'Lotto Max', 'CA', '["TUE","FRI"]', '{"encore": true, "extra": true, "maxmillions": true}'),
  ('US_POWERBALL', 'Powerball', 'US', '["MON","WED","SAT"]', '{"power_play": true, "double_play": true}'),
  ('US_MEGAMILLIONS', 'Mega Millions', 'US', '["TUE","FRI"]', '{"megaplier": true}')
ON CONFLICT (code) DO NOTHING;
