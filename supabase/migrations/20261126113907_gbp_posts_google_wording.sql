-- Google posts that stand on their own, piece 3: wording written for Google
-- (tasks/SPEC-gbp-separate-posts.md, decisions D15 and D17, Peter, 26 November 2026).
--
-- wording_source says where a Google post's wording comes from:
--   awaiting_ai  derived from the Facebook post for now; the google-wording
--                cron will ask the AI to write wording for Google
--   ai           written for Google by the AI and frozen (the sender no longer
--                re-derives it from the Facebook post)
--   facebook     follows the Facebook post's wording, and is never rewritten
--   person       edited or released by a person
-- wording_attempts counts the AI drafts tried, so a post that keeps failing
-- its checks goes back to 'facebook' instead of being asked for ever.
--
-- New rows default to awaiting_ai, including rows written by the application
-- version that is live while this migration is applied (it does not know the
-- column; its sender ignores it, so nothing changes for those rows).
--
-- The one data change (D17): Peter asked that the four Google posts created
-- before this work began keep the wording they have. They are the rows created
-- before 11:00 UTC on 26 November 2026 (one already sent, three waiting); they
-- are set to 'facebook'. So is any row that is no longer waiting, where the
-- value is only a label. The 11 reminder posts created at 11:14 UTC that day
-- stay 'awaiting_ai' and get Google wording.
--
-- Additive otherwise: two columns with defaults (no table rewrite on this
-- Postgres version), two CHECKs. Access is unchanged: service role only, RLS
-- on with no policies. supabase/tests/gbp_posts_verify.sql checks all of it.
--
-- Rollback, in words: revert the application first (the sender, the planner
-- and the google-wording cron read these columns), then a later approved
-- clean-up may remove them. To undo the data change alone:
--   update public.gbp_posts set wording_source = 'awaiting_ai'
--    where wording_source = 'facebook' and state = 'pending' and summary_edited_at is null;

alter table public.gbp_posts
  add column if not exists wording_source text not null default 'awaiting_ai',
  add column if not exists wording_attempts integer not null default 0;

comment on column public.gbp_posts.wording_source is
  'Where the wording comes from: awaiting_ai (derived from the Facebook post until the AI writes it), ai (written for Google, frozen), facebook (follows the Facebook post, never rewritten), person (edited or released by a person).';
comment on column public.gbp_posts.wording_attempts is
  'How many AI drafts have been tried for this post. At 3 the post goes back to following the Facebook wording.';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_wording_source_check') then
    alter table public.gbp_posts add constraint gbp_posts_wording_source_check
      check (wording_source is not null and wording_source in ('awaiting_ai', 'ai', 'facebook', 'person'));
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_wording_attempts_check') then
    alter table public.gbp_posts add constraint gbp_posts_wording_attempts_check
      check (wording_attempts is not null and wording_attempts >= 0);
  end if;
end $$;

-- D17: the posts that existed before this work keep their wording. Also labels
-- rows a person has already edited, and rows that are no longer waiting.
update public.gbp_posts
   set wording_source = case when summary_edited_at is not null then 'person' else 'facebook' end
 where wording_source = 'awaiting_ai'
   and (
     created_at < timestamptz '2026-11-26 11:00:00+00'
     or summary_edited_at is not null
     or state not in ('pending', 'held')
   );

-- Restated so this file stands alone; it changes nothing (already service role only).
revoke all on table public.gbp_posts from public, anon, authenticated;
grant all on table public.gbp_posts to service_role;
