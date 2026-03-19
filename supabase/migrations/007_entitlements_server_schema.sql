-- Server-side subscription management: add columns for Pirate (Compass) and Astronaut (Pro)
ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS compass_unlock BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pro_unlock BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pro_trial_ends TIMESTAMPTZ;
