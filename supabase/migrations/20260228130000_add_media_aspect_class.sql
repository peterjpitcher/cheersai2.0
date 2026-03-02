-- Add aspect_class to media_assets to record the original image's aspect ratio.
-- Populated by the media-derivatives Edge Function after reading image dimensions.
-- Existing rows default to 'square'; re-process via the library to reclassify.
alter table media_assets
  add column if not exists aspect_class text not null default 'square'
    check (aspect_class in ('square', 'story', 'landscape'));
