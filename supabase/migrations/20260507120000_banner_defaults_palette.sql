-- Banner overlay refinement: switch defaults to bronze + right.
-- The original defaults were `banner_position='bottom'` and
-- `banner_bg='#000000'` (see 20260507100000_banner_overlay_add_columns.sql).
-- The product decision is to ship with two preset colour options (bronze and
-- green) and use right-side vertical strips by default. Bronze is the new
-- default background; right is the new default position.
--
-- The UPDATE statements are conservative: they only bump rows that are still
-- on the original migration defaults. User-customised rows are left alone.

ALTER TABLE public.posting_defaults
  ALTER COLUMN banner_position SET DEFAULT 'right';

ALTER TABLE public.posting_defaults
  ALTER COLUMN banner_bg SET DEFAULT '#a57626';

UPDATE public.posting_defaults
   SET banner_position = 'right'
 WHERE banner_position = 'bottom';

UPDATE public.posting_defaults
   SET banner_bg = '#a57626'
 WHERE banner_bg = '#000000';
