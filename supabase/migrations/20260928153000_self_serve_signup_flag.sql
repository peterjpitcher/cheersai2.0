-- Self-serve sign-up switch (SPEC-self-serve-signup §4.1, §5 PR 3).
--
-- Adds one row to public.app_flags, the table that already holds the
-- billing_enforcement switch (20260924150000_publishing_hold.sql). The app reads
-- it with the service role (src/lib/signup/switch.ts). While it is false, or
-- cannot be read, nothing about self-serve sign-up is public: `/` sends
-- signed-out visitors to /login, /auth/signup goes to /login, robots.txt
-- disallows everything and the legal pages stay noindex.
--
-- It starts off. It is turned on only with Peter's yes, after Meta App Review is
-- approved, the D7 gate passes, billing_enforcement is on and the sign-up PRs
-- (5 and 6) are live (spec §4.8, §6).
--
-- Insert only and idempotent: on conflict do nothing, so re-running this never
-- turns a switch that is already on back off. The app treats a missing row as
-- off, so the code is safe to deploy before or after this migration.
--
-- Grants restate production's shape for app_flags (read 28 September 2026: RLS
-- on, no policies, every privilege for service_role, nothing for anon or
-- authenticated) and change nothing there.
--
-- Rollback (the app then treats the switch as off):
--   delete from public.app_flags where name = 'self_serve_signup';

insert into public.app_flags (name, enabled)
values ('self_serve_signup', false)
on conflict (name) do nothing;

alter table public.app_flags enable row level security;
revoke all on public.app_flags from public, anon, authenticated;
grant all on public.app_flags to service_role;
