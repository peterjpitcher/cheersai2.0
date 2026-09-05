-- Take EXECUTE away from anon and PUBLIC on the two remaining trigger functions.
--
-- Applied to production on 5 September 2026.
--
-- A trigger function is invoked by its trigger, never called directly, so no API
-- role needs EXECUTE on it. These held it only through the default privileges
-- that CREATE FUNCTION applied.
--
-- The three functions that keep their anon grant do so deliberately:
-- current_account_id, is_account_member and is_super_admin are called from
-- inside row level security policies, and a policy is evaluated as the querying
-- role. Without EXECUTE an anon query raises a permission error instead of
-- matching no rows, which breaks the page rather than securing it.

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_link_in_bio_updated_at() FROM PUBLIC, anon;
