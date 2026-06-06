-- Trigger functions (no direct RPC needed)
REVOKE EXECUTE ON FUNCTION public.purge_user_auth_snapshot() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_user_auth_snapshot() FROM anon, authenticated, PUBLIC;

-- Inspection/debug function — server-side only
REVOKE EXECUTE ON FUNCTION public.inspect_worker_db_context() FROM anon, authenticated, PUBLIC;

-- Rate limit RPC: called from server-side rate-limits.ts. Revoke anon (rate limiter runs server-side via service-role or authenticated session).
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(p_account_id uuid, p_provider text, p_endpoint text, p_window_start timestamp with time zone, p_limit_ceiling integer) FROM anon;;
