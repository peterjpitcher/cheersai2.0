-- Take the anon grants off the tables that hold secrets or auth infrastructure.
--
-- These held the full Supabase default grant, so row level security was the only
-- thing between the publishable key and stored provider tokens, OAuth states and
-- the management app API key. RLS already returns nothing to anon on all of them,
-- so behaviour does not change; this removes the outer gate as well as the inner
-- one. Tables the public link-in-bio pages genuinely read are deliberately left
-- alone.

REVOKE ALL ON public.token_vault FROM anon;
REVOKE ALL ON public.oauth_states FROM anon;
REVOKE ALL ON public.management_app_connections FROM anon;
REVOKE ALL ON public.auth_rate_limits FROM anon;
REVOKE ALL ON public.user_auth_snapshot FROM anon;
REVOKE ALL ON public.audit_log FROM anon;
REVOKE ALL ON public.provider_rate_limits FROM anon;
