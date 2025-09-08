-- Cleanup migration: Null plaintext tokens when encrypted tokens exist
-- Ensures tokens at rest are stored only in encrypted columns

-- social_connections (guard by column existence)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'social_connections' AND column_name = 'access_token_encrypted'
  ) THEN
    EXECUTE 'UPDATE public.social_connections SET access_token = NULL WHERE access_token_encrypted IS NOT NULL AND access_token IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'social_connections' AND column_name = 'refresh_token_encrypted'
  ) THEN
    EXECUTE 'UPDATE public.social_connections SET refresh_token = NULL WHERE refresh_token_encrypted IS NOT NULL AND refresh_token IS NOT NULL';
  END IF;
END $$;

-- Document the intent
COMMENT ON TABLE public.social_connections IS 'OAuth connections. Plaintext tokens are nulled when encrypted values exist.';
