-- Per-campaign "controlled test" flag for the conversion-first optimiser.
--
-- A copy rewrite adds a new ad to a live ad set. Meta then moves most of the ad set's delivery
-- onto the new ad within hours, which breaks a running A/B or message test: on 22 September
-- 2026 a rewrite applied mid-test took over a Weekday Lunch ad set. When this flag is true the
-- optimiser records no copy rewrites for the campaign, and the app refuses to apply one or to
-- switch a paused replacement on (tasks/SPEC-optimiser-rewrite-copy.md, Piece 3).
--
-- Its own column rather than a key in source_snapshot: source_snapshot is rebuilt when copy
-- is generated and rewritten at publish, so a flag stored there could be lost silently.
--
-- Additive and non-destructive: a constant default, so Postgres records it in the catalogue
-- without rewriting the table, and every existing row reads false, which is the behaviour it
-- has today (14 rows on the live project). No view or function references meta_campaigns
-- (checked on the live project, 22 September 2026). RLS is unchanged: the table's existing
-- policy covers the new column, and no grant changes are needed.
--
-- Deploy order: apply this before the code that reads it. The optimiser selects the column,
-- so if the code ships first optimiser runs fail and Apply refuses (fails closed, not open).
--
-- Rollback (only once no code reads the column, and only with the owner's approval, because
-- it discards which campaigns are marked as tests):
--   alter table public.meta_campaigns drop column if exists controlled_test;

alter table public.meta_campaigns
  add column if not exists controlled_test boolean not null default false;

comment on column public.meta_campaigns.controlled_test is
  'True while the campaign is a controlled test (A/B or message test): the optimiser proposes no copy rewrites and the app refuses to apply one or to switch a replacement ad on, because a new ad added mid-test takes over the ad set''s delivery.';
