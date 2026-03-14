-- Performance: composite partial index for the common planner query
-- (account_id + unread-only) which currently forces a full account scan
CREATE INDEX IF NOT EXISTS notifications_account_unread_idx
  ON public.notifications (account_id, created_at DESC)
  WHERE read_at IS NULL;
