# Runbook: data retention

Peter approved these retention periods on 27 September 2026 for the privacy notice and the DPA. A daily job makes them true: `/api/cron/data-retention` at 03:45 UTC (`vercel.json`) calls `public.run_data_retention(false)` (migration `20260927120000_data_retention.sql`), then sends the operator the purge reminder below.

## What each rule does

Every cutoff is measured back from the moment the job runs.

| Rule (key in the result) | Data | Kept for | Then |
|---|---|---|---|
| `notifications` | in-app notifications | 12 months from `created_at` | deleted |
| `publish_attempts` | publishing history (each attempt) | 24 months from `started_at` | deleted |
| `audit_log` | publishing audit log | 24 months from `created_at` | deleted |
| `auth_audit_log_entries` | Supabase sign-in history (`auth.audit_log_entries`) | 24 months from `created_at` | deleted |
| `link_in_bio_page_views`, `link_in_bio_clicks` | link-in-bio analytics | 24 months from `created_at` | deleted |
| `booking_conversion_identifiers` | booking tracking identifiers: IP address, user agent, hashed email and phone, `fbp`, `fbc`, `fbclid`, `gclid`, and any `fbclid` or `gclid` parameter inside `source_url` or `landing_path` | 7 days from `occurred_at` (the booking time) | set to null; the rest of the row stays for reporting |
| `booking_conversion_events` | the whole booking conversion row | 24 months from `occurred_at` | deleted |
| `meta_data_requests` | Meta data-deletion and deauthorise records | 6 years from `created_at` | deleted |
| `admin_audit` | operator (admin) actions | 6 years from `created_at` | deleted |
| `auth_rate_limits` | sign-in rate limit windows | until 24 hours after `reset_at` | deleted |
| `oauth_states` | Facebook and Instagram connection handshakes | until 24 hours after `expires_at` (or `created_at` if it has none) | deleted |

Kept on purpose: `publish_jobs`, posts and all other content. They belong to the content, which is kept for the life of the subscription. Offboarded brands are deleted by hand (below).

The booking identifiers are no loss to Meta reporting: Meta rejects Conversions API events older than 7 days, and the hourly `retry-capi-conversions` cron only re-sends rows from the last 6.5 days, so it never picks up a cleared row (a test in `tests/api/retry-capi-conversions-route.test.ts` guards this). Paid-campaign attribution uses the UTM fields and short codes, which are kept.

Each rule handles at most 10,000 rows per run, so one run stays short. If a rule has more, its `due` is higher than its `done` and the log shows a warning; the next day's run carries on. Running the function twice is safe: the second run finds nothing left to do.

## Operator reminder: brands due for deletion or lapsed

Deleting and closing stay manual (Peter's decisions). After the retention rules, the job emails `OPERATOR_ALERT_EMAIL` one message with up to two lists:

- **Due for deletion:** every brand with `accounts.offboarded_at` set whose `purge_after` has passed and which still exists, with how many days overdue it is.
- **No subscription for 90 days** (decision L8, 27 September 2026): every brand that is not offboarded, has no billing override, has no subscription in a live status, and whose last subscription ended at least 90 London calendar days ago. The end is the later of `canceled_at` and `current_period_end` (Stripe's `canceled_at` is the time of the cancel request), falling back to `updated_at`.

Both link to Admin, Offboarding (`/admin#offboarding`). No email is sent when both lists are empty. It repeats every day until each brand is dealt with; setting a lapsed brand's billing override to suspended keeps it without reminders. See `docs/runbooks/customer-offboarding.md`.

## Checking it

- Dry run (counts only, changes nothing), in the Supabase SQL editor:

  ```sql
  select public.run_data_retention(true);
  ```

  Each rule shows `due` (rows past the cutoff) and `done` (always 0 in a dry run).
- The cron logs one `[data-retention] retention rule` line per rule and one `purge reminder` line (Axiom and Vercel logs). The response body has the same counts.
- If the job fails it returns 500 and logs an error, so Vercel shows it as failed. The two steps are independent: a retention failure still sends the reminder, and a reminder failure still runs retention.

## Deploying and rolling back

- **Apply the migration before the cron is deployed.** Until `public.run_data_retention` exists the cron fails every night with a 500 (visible, but noisy).
- `OPERATOR_ALERT_EMAIL`, `RESEND_API_KEY` and `RESEND_FROM` must be set in production; the reminder fails the run rather than skip quietly when brands are due and email cannot be sent.
- To stop the job: remove the `/api/cron/data-retention` entry from `vercel.json` and deploy. To remove the function: `drop function if exists public.run_data_retention(boolean);`. Rows already deleted or cleared cannot be brought back.
- Local test: `supabase/tests/data_retention_verify.sql` inserts rows either side of every cutoff on a local rebuild, runs a dry run, a real run and a second run, and checks exactly the old rows went. Never run it against production.
