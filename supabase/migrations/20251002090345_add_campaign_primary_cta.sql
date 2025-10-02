-- Add primary_cta column for campaign call-to-action URLs or copy
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS primary_cta text;

-- Refresh PostgREST schema cache so the new column is available immediately
NOTIFY pgrst, 'reload schema';
