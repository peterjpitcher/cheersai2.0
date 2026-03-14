CREATE TABLE IF NOT EXISTS public.content_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  prompt      text NOT NULL,
  platforms   text[] NOT NULL DEFAULT '{}',
  tone_adjust text NOT NULL DEFAULT 'default',
  cta_url     text,
  notes       text,
  use_count   integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_templates_account_idx ON public.content_templates (account_id, updated_at DESC);

ALTER TABLE public.content_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Content templates accessible by account" ON public.content_templates
  FOR ALL
  USING (auth.role() = 'service_role' OR account_id = public.current_account_id())
  WITH CHECK (auth.role() = 'service_role' OR account_id = public.current_account_id());
