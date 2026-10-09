-- Per-province Canadian EXTRA (BC vs WCLC print formats, same national draw date).
-- Example: {"CA-BC":"47-73-74-97","CA-AB":"1234567"} — falls back to draws.extra_number when key missing.
ALTER TABLE draws ADD COLUMN IF NOT EXISTS extra_numbers_by_jurisdiction JSONB;
COMMENT ON COLUMN draws.extra_numbers_by_jurisdiction IS 'Map CA-XX -> official EXTRA string; use with draws.extra_number as default / WCLC 7-digit';
