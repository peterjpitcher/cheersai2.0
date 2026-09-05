-- Restore anon EXECUTE on the two tenant predicates.
--
-- Applied to production on 5 September 2026, correcting a revoke made minutes
-- earlier in 20260905052738.
--
-- is_account_member and is_super_admin are called from inside row level security
-- policies on content_items, link_in_bio_profiles, link_in_bio_tiles and others.
-- Without EXECUTE, an anon query against those tables raises
-- "permission denied for function is_account_member" instead of simply matching
-- no rows, so a public page reading them with the publishable key would break.
-- Both functions read auth.uid(), which is null for anon, so they return false
-- and deny access on their own merits. Revoking them bought nothing.
--
-- The revoke on increment_rate_limit stands. That one writes, takes the account
-- id from its caller with no membership check, and is called only by the
-- service-role client.

GRANT EXECUTE ON FUNCTION public.is_account_member(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon;
