-- The v1→v2 bridge migration created the content_type ENUM but forgot to add
-- the column to content_items. Existing v1 rows default to 'instant_post'.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS content_type public.content_type NOT NULL DEFAULT 'instant_post';
