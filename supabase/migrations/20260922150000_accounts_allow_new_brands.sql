-- Let the Admin page create a second brand on the live project.
--
-- Admin > Create brand has never worked in production. Two leftovers from the one-login,
-- one-account design block the insert (checked on the live project, 22 September 2026;
-- both attempts to create "Orange Jelly" failed on the first):
--   1. accounts.id has no default, because it used to be copied from the auth user id.
--      The repo baseline (00000000000000_baseline.sql) declares DEFAULT gen_random_uuid();
--      production drifted. This restores it.
--   2. accounts_email_key makes the contact email unique, so two brands run by the same
--      person cannot share one. The contact email is where failure and expiring-connection
--      alerts go; nothing looks brands up by it (no code path, function, foreign key or
--      view uses it), so it does not need to be unique. The constraint only exists in
--      production; no migration creates it.
-- The third leftover, accounts.auth_user_id NOT NULL, stays: the app now sets it to the
-- creating admin (src/app/(app)/admin/actions.ts).
--
-- Low risk: setting a default and dropping a unique constraint change no rows, and each
-- takes only a brief lock on a two-row table. Both statements are safe to re-run, and both
-- are no-ops on a fresh database built from the repo.
--
-- Rollback (only while no two brands share a contact email):
--   alter table public.accounts alter column id drop default;
--   alter table public.accounts add constraint accounts_email_key unique (email);

alter table public.accounts alter column id set default gen_random_uuid();

alter table public.accounts drop constraint if exists accounts_email_key;
