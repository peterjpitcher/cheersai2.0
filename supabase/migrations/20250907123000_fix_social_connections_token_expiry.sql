-- Fix token expiry field mismatch on social_connections
-- Prefer token_expires_at; backfill from any legacy expires_at then drop it

DO $$
BEGIN
  -- If legacy expires_at exists, backfill and drop it
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'social_connections' 
      AND column_name = 'expires_at'
  ) THEN
    -- Backfill token_expires_at with expires_at where missing
    EXECUTE 'UPDATE public.social_connections
             SET token_expires_at = COALESCE(token_expires_at, expires_at)';

    -- Drop the legacy column
    EXECUTE 'ALTER TABLE public.social_connections
             DROP COLUMN IF EXISTS expires_at';
  END IF;
END $$;

-- Optional: document the column purpose
COMMENT ON COLUMN public.social_connections.token_expires_at IS 'Expiry timestamp for the active access token (platform-dependent)';
