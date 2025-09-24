-- Adds support for capturing published URLs and per-step form requirements
ALTER TABLE IF EXISTS public.content
  ADD COLUMN IF NOT EXISTS published_url text;
ALTER TABLE IF EXISTS public.content_versions
  ADD COLUMN IF NOT EXISTS published_url text;
ALTER TABLE IF EXISTS public.workflow_steps
  ADD COLUMN IF NOT EXISTS form_requirements jsonb DEFAULT '{}'::jsonb NOT NULL;
