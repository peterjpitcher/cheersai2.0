-- Make meta_ad_accounts service-role only (tasks/SPEC-encrypt-meta-ad-tokens.md).
--
-- anon and authenticated held full table rights, and the member RLS policy let
-- any signed-in member of a brand read that brand's plaintext Meta tokens with
-- the public anon key. Every app read and write of this table already uses the
-- service-role client (checked 2026-09-25: connections, campaigns, crons, CAPI,
-- ops script), and no policy, view or function on another table references it,
-- so removing the browser roles' access closes the exposure without changing
-- any app behaviour.
--
-- The member RLS policy is left in place: it is harmless without grants and
-- keeps the multi-brand policy manifest unchanged.
--
-- Rollback:
--   grant select, insert, update, delete, truncate, references, trigger
--     on public.meta_ad_accounts to anon, authenticated;

revoke all on public.meta_ad_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.meta_ad_accounts to service_role;
