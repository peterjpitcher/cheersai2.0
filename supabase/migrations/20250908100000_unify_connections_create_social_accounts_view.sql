-- Create a read-only compatibility view mapping social_accounts to social_connections
-- Only create if a view named social_accounts does not already exist AND there is no table by that name.

DO $$
BEGIN
  -- Check if a relation named social_accounts already exists
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'social_accounts'
  ) THEN
    -- If it's not a view, skip creating the compatibility view
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'social_accounts' AND c.relkind = 'v'
    ) THEN
      RAISE NOTICE 'public.social_accounts exists and is not a view; skipping compatibility view creation.';
      RETURN;
    END IF;
  END IF;

  -- Create or replace the view
  EXECUTE 'CREATE OR REPLACE VIEW public.social_accounts AS
    SELECT
      sc.id,
      sc.tenant_id,
      sc.platform,
      sc.account_id,
      sc.account_name,
      NULL::text AS access_token,
      NULL::text AS refresh_token,
      sc.token_expires_at,
      sc.page_id,
      sc.page_name,
      NULL::text AS profile_id,
      NULL::text AS instagram_id,
      NULL::text AS access_token_secret,
      NULL::text AS username,
      sc.metadata,
      sc.is_active,
      sc.created_at,
      sc.updated_at
    FROM public.social_connections sc';

  EXECUTE 'COMMENT ON VIEW public.social_accounts IS ''Compatibility view over social_connections. Tokens intentionally omitted.''';
END $$;
