-- Track if user has ever had Astronaut subscription (for returning users: show "Upgrade" not "Start free trial")
ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS had_astronaut_subscription BOOLEAN DEFAULT FALSE;
