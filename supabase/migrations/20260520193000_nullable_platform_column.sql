-- v2 content items support multiple platforms via body_draft.platforms,
-- so the v1 single-platform column no longer needs to be NOT NULL.
-- Existing v1 rows retain their platform value; new v2 rows insert NULL.

ALTER TABLE public.content_items ALTER COLUMN platform DROP NOT NULL;
