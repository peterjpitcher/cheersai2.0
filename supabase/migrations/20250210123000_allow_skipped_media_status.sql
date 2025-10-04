alter table public.media_assets
  drop constraint if exists media_assets_processed_status_check;

alter table public.media_assets
  add constraint media_assets_processed_status_check
    check (processed_status in ('pending','processing','ready','failed','skipped'));
