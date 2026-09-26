-- Past-due grace from the start of the unpaid period (feat/stripe-billing review, item A).
--
-- When a renewal payment fails, Stripe has already moved the subscription's
-- period forward, so current_period_end is the END of the unpaid period.
-- Measuring the 7-day grace from it gave about five weeks (monthly) or a year
-- (annual). The grace now runs from current_period_start, the start of the
-- unpaid period, read from the subscription item like current_period_end
-- (Stripe API 2026-08-26.dahlia).
--
-- Expand only: one nullable column, no backfill. Reconcile fills it on the
-- next Stripe event or admin "Re-sync from Stripe"; until then a row with no
-- start falls back to the period end (the old rule), so no brand loses access
-- early. Production held no subscriptions rows when this was written
-- (SELECT-only check, 2026-09-26).
--
-- Deploy order: apply this before deploying the app code that writes the
-- column (reconcile). The publish-queue edge function reads the column but
-- falls back to the old columns if it is missing, so it may deploy either side.
--
-- Rollback (after reverting the code that reads and writes it):
--   alter table public.subscriptions drop column if exists current_period_start;

alter table public.subscriptions
  add column if not exists current_period_start timestamptz;

comment on column public.subscriptions.current_period_start is
  'Start of the current billing period, from the Stripe subscription item. For a past_due subscription this is the start of the unpaid period; the 7-day grace runs from it. Null on rows stored before 2026-09-26.';
