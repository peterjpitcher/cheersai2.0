-- =============================================================================
-- Content Domain Migration
-- =============================================================================
-- Creates content management tables:
--   content_items, content_item_versions, media_library, content_media_attachments
-- content_media_attachments is a proper junction table (DATA-03: no uuid[] columns).
-- content_item_versions stores snapshots at publish time (DATA-05).
-- RLS enabled on all tables with account-scoped policies (D-11).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: content_items
-- ---------------------------------------------------------------------------

CREATE TABLE public.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  content_type public.content_type NOT NULL,
  status public.content_status NOT NULL DEFAULT 'draft',
  title text,
  body_draft jsonb,
  campaign_name text,
  scheduled_at timestamptz,
  event_date date,
  event_end_date date,
  coupon_code text,
  recurring_day_of_week integer CHECK (recurring_day_of_week BETWEEN 0 AND 6),
  auto_confirm boolean NOT NULL DEFAULT false,
  ai_generation_params jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_items_account_status ON public.content_items(account_id, status);
CREATE INDEX idx_content_items_account_scheduled ON public.content_items(account_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE TRIGGER trg_content_items_updated_at
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_items_select" ON public.content_items
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "content_items_insert" ON public.content_items
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "content_items_update" ON public.content_items
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "content_items_delete" ON public.content_items
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: content_item_versions (DATA-05: snapshot at publish time)
-- ---------------------------------------------------------------------------

CREATE TABLE public.content_item_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, version_number)
);

CREATE INDEX idx_content_item_versions_account ON public.content_item_versions(account_id);

ALTER TABLE public.content_item_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_item_versions_select" ON public.content_item_versions
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "content_item_versions_insert" ON public.content_item_versions
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "content_item_versions_update" ON public.content_item_versions
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "content_item_versions_delete" ON public.content_item_versions
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: media_library
-- ---------------------------------------------------------------------------

CREATE TABLE public.media_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL,
  file_size_bytes integer,
  width integer,
  height integer,
  tags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_library_account ON public.media_library(account_id);

ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_library_select" ON public.media_library
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "media_library_insert" ON public.media_library
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "media_library_update" ON public.media_library
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "media_library_delete" ON public.media_library
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Table: content_media_attachments (DATA-03: junction table, not uuid[])
-- ---------------------------------------------------------------------------

CREATE TABLE public.content_media_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES public.media_library(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, media_id)
);

ALTER TABLE public.content_media_attachments ENABLE ROW LEVEL SECURITY;

-- RLS joins through content_items (no direct account_id)
CREATE POLICY "content_media_attachments_select" ON public.content_media_attachments
  FOR SELECT USING (content_item_id IN (
    SELECT id FROM public.content_items
    WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY "content_media_attachments_insert" ON public.content_media_attachments
  FOR INSERT WITH CHECK (content_item_id IN (
    SELECT id FROM public.content_items
    WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY "content_media_attachments_update" ON public.content_media_attachments
  FOR UPDATE USING (content_item_id IN (
    SELECT id FROM public.content_items
    WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY "content_media_attachments_delete" ON public.content_media_attachments
  FOR DELETE USING (content_item_id IN (
    SELECT id FROM public.content_items
    WHERE account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid())
  ));
