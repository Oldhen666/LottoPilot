-- Fix Security Advisor: Enable RLS on audit_logs
-- Table was exposed to PostgREST without RLS, allowing unauthorized access.
-- With RLS enabled and no permissive policies, anon key gets no access.
-- Service role (backend) bypasses RLS for any server-side writes.

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- No policies: anon/authenticated users cannot SELECT/INSERT/UPDATE/DELETE.
-- If you need to write audit logs from the app, add an INSERT policy for authenticated users only.
