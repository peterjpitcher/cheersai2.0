-- REVIEW migration (not auto-run): Plan for social_accounts deprecation
-- Steps for a future release window:
-- 1) CREATE TABLE public.social_accounts_legacy AS TABLE public.social_accounts;
-- 2) DROP TABLE public.social_accounts;
-- 3) CREATE VIEW public.social_accounts AS
--      SELECT sc.id, sc.tenant_id, sc.platform, sc.account_id, sc.account_name,
--             NULL::text AS access_token, NULL::text AS refresh_token,
--             sc.token_expires_at, sc.page_id, sc.page_name,
--             NULL::text AS profile_id, NULL::text AS instagram_id,
--             NULL::text AS access_token_secret, NULL::text AS username,
--             sc.metadata, sc.is_active, sc.created_at, sc.updated_at
--        FROM public.social_connections sc;
-- 4) Announce removal timeline; keep legacy table copy as rollback for 1 release.
-- 5) After verification, DROP TABLE public.social_accounts_legacy;

-- This file is intentionally suffixed with .REVIEW to avoid automatic application by supabase db push.

