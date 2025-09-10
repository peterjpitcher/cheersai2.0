-- Set fixed search_path for functions flagged by linter

-- Use empty search_path to avoid relying on caller's role settings
DO $$
BEGIN
  -- advisory lock helpers
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'acquire_inspiration_lock' AND p.pronargs = 0
  ) THEN
    EXECUTE 'ALTER FUNCTION public.acquire_inspiration_lock() SET search_path = '''''; -- empty
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'release_inspiration_lock' AND p.pronargs = 0
  ) THEN
    EXECUTE 'ALTER FUNCTION public.release_inspiration_lock() SET search_path = '''''; -- empty
  END IF;

  -- increment_guardrails_usage(uuid)
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'increment_guardrails_usage' AND p.pronargs = 1
  ) THEN
    EXECUTE 'ALTER FUNCTION public.increment_guardrails_usage(uuid) SET search_path = '''''; -- empty
  END IF;
END $$;

