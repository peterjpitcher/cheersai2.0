-- Rollback for the story event-overlay backfill applied 2026-07-27.
--
-- The backfill set banner_enabled = true on 16 content_variants rows (8 story
-- posts x 2 platforms) belonging to event campaigns, so the publish worker
-- prints the computed proximity label (TONIGHT, THIS FRIDAY, and so on) on the
-- 1080x1920 story crop.
--
-- Every row below had banner_enabled = false and banner_text_override = NULL
-- before the change, so restoring false returns them exactly to their prior
-- state. banner_text_override was never written and is not touched here.
--
-- Campaigns affected: Cash Bingo, Cowboys & Queens Country Music Bingo.
-- Earliest publish: 2026-07-28 06:00 UTC. Running this before then reverts
-- every affected post; after that, already-published rows keep their overlay
-- and only the remaining scheduled ones revert.
--
-- This list is explicit on purpose. Never run an unscoped update against
-- content_variants.

update content_variants
set banner_enabled = false
where id in (
  '70213cfd-9cc9-40bd-8c44-f9cea2bb73a2',  -- 2026-07-28 Cash Bingo
  '879dab5f-3149-4195-ba88-84d81f3615d1',  -- 2026-07-28 Cash Bingo
  '7b10ad2b-a555-49ff-9c94-8530cb650dcd',  -- 2026-07-29 Cash Bingo
  'ee459a5e-8763-4d47-91eb-71ae2aa733cc',  -- 2026-07-29 Cash Bingo
  '5798dc0a-5590-4c3a-81c8-952bccbe3ce7',  -- 2026-07-31 Cowboys & Queens
  'f8e76bdb-55a8-48d5-a97f-3d62a9b4f4e8',  -- 2026-07-31 Cowboys & Queens
  '09e8d7c7-e89d-4bf3-812a-c6a9cfcf4da2',  -- 2026-08-03 Cowboys & Queens
  'cc4021c2-17ad-40b5-9978-ece29b4f62a1',  -- 2026-08-03 Cowboys & Queens
  '5803e3c0-b59a-46ae-aa44-cd012c7e10ea',  -- 2026-08-07 Cowboys & Queens
  'd7e6038f-4d74-4e76-9d73-675fd26bb1c2',  -- 2026-08-07 Cowboys & Queens
  '43392865-93dd-4d40-bb7a-9b468d33eecc',  -- 2026-08-10 Cowboys & Queens
  '92e0fc8c-2ca4-48f1-bd2b-f8fbbb4cc7e6',  -- 2026-08-10 Cowboys & Queens
  '8b61c50d-3366-4f9f-ab80-3e11f757c562',  -- 2026-08-13 Cowboys & Queens
  'da4a4ce7-846d-4aa5-b260-40a166403452',  -- 2026-08-13 Cowboys & Queens
  '84bcaee4-f7fd-40ab-ab20-04f5e4d73b6e',  -- 2026-08-14 Cowboys & Queens
  'c32bc833-c06a-4c87-80e9-b4f6d07611dc'   -- 2026-08-14 Cowboys & Queens
);

-- Verify: expect 16 rows, all banner_enabled = false.
-- select id, banner_enabled, banner_text_override from content_variants
-- where id in ( ...the same list... );
