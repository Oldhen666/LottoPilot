-- Compass pre-computed snapshots (updated daily with scraper)
-- App fetches directly; no client-side computation needed

CREATE TABLE IF NOT EXISTS compass_snapshots (
  game_code TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL,
  long_window_days INT NOT NULL DEFAULT 3650,
  short_window_days INT NOT NULL DEFAULT 180,
  long_draws INT NOT NULL DEFAULT 0,
  short_draws INT NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compass_snapshots_updated ON compass_snapshots(updated_at DESC);

-- RLS: public read
ALTER TABLE compass_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Compass snapshots public read" ON compass_snapshots;
CREATE POLICY "Compass snapshots public read" ON compass_snapshots FOR SELECT USING (true);
