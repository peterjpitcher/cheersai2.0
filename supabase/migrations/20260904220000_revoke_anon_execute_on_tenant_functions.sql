-- Close anon and PUBLIC EXECUTE on three tenant-sensitive functions.
--
-- NOT YET APPLIED. Drafted 4 September 2026, awaiting the owner's approval
-- before `supabase db push`.
--
-- increment_rate_limit is SECURITY DEFINER, takes p_account_id from its caller,
-- and upserts public.provider_rate_limits with no membership check. Its ACL is
-- "=X/postgres", the PUBLIC grant, so any holder of the publishable key can
-- inflate any tenant's rate-limit counter for any provider and endpoint, which
-- throttles that tenant's publishing. The foreign key to accounts also makes it
-- an oracle for whether an account id exists. Migration 20260527080658 revoked
-- it FROM anon but not FROM PUBLIC, so anon still inherits EXECUTE.
--
-- is_account_member and is_super_admin are the tenant gate itself. Migration
-- 20260714120000 revoked them FROM public but not FROM anon, so the default ACL
-- grant survived. Both read auth.uid(), which is null for anon, so this is
-- contrary to stated intent rather than currently exploitable.
--
-- Verified before writing this migration: the only caller of increment_rate_limit
-- is incrementRateLimit in src/lib/providers/rate-limits.ts, which uses
-- createServiceSupabaseClient. service_role keeps its own explicit grant, so no
-- application path loses access.
--
-- Rollback: GRANT EXECUTE ... TO anon (and to PUBLIC for increment_rate_limit).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, text, timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, text, timestamptz, integer) FROM anon;

REVOKE EXECUTE ON FUNCTION public.is_account_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_account_member(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;

COMMIT;
