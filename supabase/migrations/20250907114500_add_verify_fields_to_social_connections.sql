-- Add verification tracking fields to social_connections
ALTER TABLE public.social_connections
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verify_status TEXT CHECK (verify_status IN ('pass','fail','warning')),
  ADD COLUMN IF NOT EXISTS verify_details JSONB;

COMMENT ON COLUMN public.social_connections.verified_at IS 'Last time the connection was verified via health check';
COMMENT ON COLUMN public.social_connections.verify_status IS 'Result of last verification: pass/fail/warning';
COMMENT ON COLUMN public.social_connections.verify_details IS 'Structured check results for last verification';

