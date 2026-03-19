-- RLS: Simple read-only for anon (public dashboard)
-- Service role bypasses RLS for scripts

ALTER TABLE lotteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE lottery_draws ENABLE ROW LEVEL SECURITY;
ALTER TABLE lottery_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_errors ENABLE ROW LEVEL SECURITY;

-- Policy: anon can read all (for public dashboard)
CREATE POLICY "anon_read_lotteries" ON lotteries FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_lottery_draws" ON lottery_draws FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_lottery_state" ON lottery_state FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_job_runs" ON job_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_job_errors" ON job_errors FOR SELECT TO anon USING (true);

-- Service role (used by scripts) bypasses RLS by default
-- No INSERT/UPDATE policies for anon - only service role can write
