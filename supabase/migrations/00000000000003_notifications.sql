-- =============================================================================
-- Notifications Domain Migration
-- =============================================================================
-- Creates notification infrastructure:
--   notification_urgency enum, notifications table
-- Urgency enum supports urgent (email + in-app) vs standard (in-app only) (DATA-07).
-- RLS enabled with account-scoped policies (D-11).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum: notification_urgency (DATA-07)
-- ---------------------------------------------------------------------------

CREATE TYPE public.notification_urgency AS ENUM ('urgent', 'standard');

-- ---------------------------------------------------------------------------
-- Table: notifications (DATA-07)
-- ---------------------------------------------------------------------------

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  urgency public.notification_urgency NOT NULL DEFAULT 'standard',
  title text NOT NULL,
  body text,
  category text,
  resource_type text,
  resource_id uuid,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partial index for efficiently querying unread notifications
CREATE INDEX idx_notifications_account_unread ON public.notifications(account_id, read_at)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));

CREATE POLICY "notifications_delete" ON public.notifications
  FOR DELETE USING (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()));
