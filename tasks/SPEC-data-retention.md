# SPEC: data retention clean-up

## Why

The privacy notice and DPA state retention periods (approved by Peter on 27 September 2026). Nothing deleted old data, so the stated periods were not true. This adds one daily job that enforces them.

## What changes

- Migration `20260927120000_data_retention.sql`: `public.run_data_retention(p_dry_run boolean default true) returns jsonb`, security definer, empty `search_path`, execute granted to `service_role` only. It returns `due` and `done` counts per rule and, when `p_dry_run` is false, deletes or clears (periods and columns in `docs/runbooks/data-retention.md`). At most 10,000 rows per rule per run; idempotent.
- Cron `/api/cron/data-retention` (03:45 UTC daily, `vercel.json`): calls the function with `p_dry_run: false`, logs the counts, then emails `OPERATOR_ALERT_EMAIL` the offboarded brands past `purge_after` that still exist (nothing when none). Returns 500 if either step fails.
- Admin page: the Offboarding card gets `id="offboarding"` so the email links straight to it.
- Docs: `docs/runbooks/data-retention.md` (new), `docs/runbooks/customer-offboarding.md`, `docs/agent-reference.md`.

## Decisions

- Periods as approved: notifications 12 months; publishing history (`publish_attempts`), `audit_log` and Supabase sign-in history (`auth.audit_log_entries`) 24 months; link-in-bio views and clicks 24 months; booking identifiers cleared 7 days after the booking and the whole booking row deleted after 24 months; `meta_data_requests` and `admin_audit` 6 years; expired `auth_rate_limits` and `oauth_states` 24 hours after expiry.
- `publish_jobs` and content rows are kept for the life of the subscription.
- Offboarded brand deletion stays manual; the job only reminds the operator daily.
- "Booking time" is `booking_conversion_events.occurred_at`, the time Meta's 7-day window is measured from.
- Booking identifiers cleared: `client_ip_address`, `client_user_agent`, `email_sha256`, `phone_sha256`, `fbp`, `fbc`, `fbclid`, `gclid`, plus any `fbclid` or `gclid` parameter inside `source_url` and `landing_path` (the same click id). UTM fields, short codes and `booking_id` stay: attribution needs them and they identify a campaign or booking, not a person's browser.
- The CAPI retry cron already stops at 6.5 days, so it never sees a cleared row; no change to it, only a test that pins the window below 7 days.
- An `oauth_states` row with no `expires_at` is treated as expiring when it was created.

## Deploy order and rollback

1. Apply the migration to production, then run `select public.run_data_retention(true);` to check the counts.
2. Merge and deploy; the cron starts the next night at 03:45 UTC.

Rollback: remove the cron from `vercel.json` and deploy, then `drop function if exists public.run_data_retention(boolean);`. Deleted or cleared rows cannot be restored.
