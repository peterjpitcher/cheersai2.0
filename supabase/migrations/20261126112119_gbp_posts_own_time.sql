-- Google posts that stand on their own, piece 2: a Google post's own time
-- (tasks/SPEC-gbp-separate-posts.md, decision D16, Peter, 26 November 2026).
--
-- Until now a Google post always went out at its Facebook post's time. This
-- column lets a person move it on its own. NULL means "the Facebook post's
-- time", so every existing row behaves exactly as before.
--
-- Additive only: one nullable column with no default, no constraint, no index
-- (the sender reads a brand's pending rows through gbp_posts_live_states and
-- works out which are due in code). Nothing existing changes.
--
-- Access is unchanged: service role only, RLS on with no policies, nothing held
-- by public, anon or authenticated. The new column takes the table's grants.
-- supabase/tests/gbp_posts_verify.sql checks the column.
--
-- Rollback, in words: revert the application first (the sender and the planner
-- read this column), then a later approved clean-up may remove the column.
-- Leaving it in place is harmless.

alter table public.gbp_posts
  add column if not exists scheduled_for timestamptz;

comment on column public.gbp_posts.scheduled_for is
  'The Google post''s own time, set when a person moves it. NULL means it goes out at its Facebook post''s time.';

-- Restated so this file stands alone; it changes nothing (already service role only).
revoke all on table public.gbp_posts from public, anon, authenticated;
grant all on table public.gbp_posts to service_role;
