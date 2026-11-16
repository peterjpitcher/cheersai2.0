-- Google posting, piece 3: a Google version attached to a Facebook feed post
-- (tasks/SPEC-gbp-posting-reintroduction.md, decision D12, Peter, 16 November 2026).
--
-- A row in public.gbp_posts is now the Google version of ONE Facebook feed
-- post (content_item_id). It goes out when that post's scheduled time arrives,
-- from its own cron, and never through content_items or publish_jobs. These
-- columns hold what that needs: the wording, the event details, the button,
-- and where the version is in its life.
--
-- Additive only. public.gbp_posts exists in production, is empty and has never
-- been written, so every new NOT NULL column has a default and no existing row
-- or constraint changes. The older delivery_state column and its CHECK are left
-- exactly as they are and are no longer used (see the column comment): changing
-- that CHECK would mean replacing the constraint, which is not approved here.
--
-- Access is unchanged: service role only, RLS on with no policies, nothing held
-- by public, anon or authenticated. New columns take the table's grants.
-- supabase/tests/gbp_posts_verify.sql checks every column, CHECK and index below.
--
-- Rollback, in words: revert the application first (the cron and the planner
-- actions read these columns), then a later approved clean-up may remove the
-- columns, constraints and index added here. Leaving them in place is harmless.

alter table public.gbp_posts
  add column if not exists state text not null default 'pending',
  add column if not exists hold_reason text,
  add column if not exists topic_type text not null default 'STANDARD',
  add column if not exists summary text not null default '',
  add column if not exists cta_type text,
  add column if not exists cta_url text,
  add column if not exists event_title text,
  add column if not exists event_start timestamptz,
  add column if not exists event_end timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists summary_edited_at timestamptz,
  add column if not exists resend_count integer not null default 0;

comment on column public.gbp_posts.delivery_state is
  'Superseded by state (piece 3, D12). Not read or written any more; to be removed in a later approved clean-up.';
comment on column public.gbp_posts.state is
  'pending (waiting for its time), held (a person must release it; see hold_reason), claimed (a send is in flight), sent (Google accepted it), uncertain (the request left but the answer was lost), failed, skipped (deliberately not sent).';
comment on column public.gbp_posts.hold_reason is
  'Why a held version is waiting for a person, for example alcohol_promotion. Also the reason a version was skipped.';
comment on column public.gbp_posts.topic_type is
  'STANDARD or EVENT, as Google names them.';
comment on column public.gbp_posts.summary is
  'The Google wording, derived from the Facebook post and cleaned (no hashtags, handles, phone numbers, emails or links), at most 1,500 characters.';
comment on column public.gbp_posts.cta_type is
  'The button: BOOK or LEARN_MORE, or null for no button. Always set together with cta_url.';
comment on column public.gbp_posts.event_start is
  'EVENT only. The instant the event starts; sent to Google as London wall-clock parts.';
comment on column public.gbp_posts.attempts is
  'How many sends have been tried. Reset when a person retries a failed version.';
comment on column public.gbp_posts.next_attempt_at is
  'Earliest time for the next send (after a backoff) or the next reconcile of an uncertain version. Null means as soon as it is due.';
comment on column public.gbp_posts.summary_edited_at is
  'Set when a person edits or releases the wording; from then on it no longer follows the Facebook post.';
comment on column public.gbp_posts.resend_count is
  'How many times an uncertain version was sent again after no matching post was found on Google. Never more than 1.';

-- CHECK constraints. A CHECK passes when it evaluates to NULL, so every rule
-- that depends on a nullable column says IS NOT NULL in so many words.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_state_check') then
    alter table public.gbp_posts add constraint gbp_posts_state_check
      check (state is not null and state in ('pending', 'held', 'claimed', 'sent', 'uncertain', 'failed', 'skipped'));
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_topic_type_check') then
    alter table public.gbp_posts add constraint gbp_posts_topic_type_check
      check (topic_type is not null and topic_type in ('STANDARD', 'EVENT'));
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_cta_type_check') then
    alter table public.gbp_posts add constraint gbp_posts_cta_type_check
      check (cta_type is null or cta_type in ('BOOK', 'LEARN_MORE'));
  end if;

  -- A button needs both its kind and its link, or neither.
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_cta_pair_check') then
    alter table public.gbp_posts add constraint gbp_posts_cta_pair_check
      check ((cta_type is null and cta_url is null) or (cta_type is not null and cta_url is not null and cta_url ~ '^https://'));
  end if;

  -- An event post needs a title, a start and a later end.
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_event_fields_check') then
    alter table public.gbp_posts add constraint gbp_posts_event_fields_check
      check (
        topic_type is not null
        and (
          topic_type <> 'EVENT'
          or (
            event_title is not null and length(btrim(event_title)) > 0
            and event_start is not null and event_end is not null
            and event_end > event_start
          )
        )
      );
  end if;

  -- A held version always says why.
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_held_reason_check') then
    alter table public.gbp_posts add constraint gbp_posts_held_reason_check
      check (state is not null and (state <> 'held' or (hold_reason is not null and length(btrim(hold_reason)) > 0)));
  end if;

  -- A send in flight, or one whose answer was lost, records when it was claimed.
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_claimed_at_check') then
    alter table public.gbp_posts add constraint gbp_posts_claimed_at_check
      check (state is not null and (state not in ('claimed', 'uncertain') or claimed_at is not null));
  end if;

  -- A sent version records what Google called it and when.
  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_sent_fields_check') then
    alter table public.gbp_posts add constraint gbp_posts_sent_fields_check
      check (state is not null and (state <> 'sent' or (google_post_name is not null and sent_at is not null)));
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_summary_length_check') then
    alter table public.gbp_posts add constraint gbp_posts_summary_length_check
      check (summary is not null and char_length(summary) <= 1500);
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_attempts_check') then
    alter table public.gbp_posts add constraint gbp_posts_attempts_check
      check (attempts is not null and attempts >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.gbp_posts'::regclass and conname = 'gbp_posts_resend_count_check') then
    alter table public.gbp_posts add constraint gbp_posts_resend_count_check
      check (resend_count is not null and resend_count between 0 and 1);
  end if;
end $$;

-- The sender looks for a brand's versions that are still in play. The existing
-- unique indexes (one per content item, one per event per profile) stay as they are.
create index if not exists gbp_posts_live_states
  on public.gbp_posts (account_id, state, next_attempt_at)
  where state in ('pending', 'claimed', 'uncertain');

-- Restated so this file stands alone; it changes nothing (already service role only).
revoke all on table public.gbp_posts from public, anon, authenticated;
grant all on table public.gbp_posts to service_role;
