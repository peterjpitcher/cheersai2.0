# Runbook: data retention

Peter approved these retention periods on 27 September 2026 for the privacy notice and the DPA. A daily job makes them true: `/api/cron/data-retention` at 03:45 UTC (`vercel.json`) calls `public.run_data_retention(false)` (migration `20260927120000_data_retention.sql`, restated with the team invitations rule, approved on 28 September 2026 as P6, by `20260928161500_team_invitations.sql`, and with the self-serve sign-up rules, also P6, by `20260928170000_self_serve_signups.sql`), deletes the self-serve logins it lists (below), then sends the operator the purge reminder below.

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
| `team_invitations` | team invitations (who was invited to which brand, by whom) | until 24 hours after the invitation was accepted, declined, cancelled or expired (7 days after it was sent), whichever came first | deleted |
| `self_serve_signups` | sign-up records (when someone asked, confirmed and created a venue; no email, name or IP) | 24 months from `requested_at` | deleted |

Kept on purpose: `publish_jobs`, posts and all other content. They belong to the content, which is kept for the life of the subscription. Offboarded brands are deleted by hand (below).

The booking identifiers are no loss to Meta reporting: Meta rejects Conversions API events older than 7 days, and the hourly `retry-capi-conversions` cron only re-sends rows from the last 6.5 days, so it never picks up a cleared row (a test in `tests/api/retry-capi-conversions-route.test.ts` guards this). Paid-campaign attribution uses the UTM fields and short codes, which are kept.

Each rule handles at most 10,000 rows per run, so one run stays short. If a rule has more, its `due` is higher than its `done` and the log shows a warning; the next day's run carries on. Running the function twice is safe: the second run finds nothing left to do.

## Self-serve logins that never became a venue

Decision P6 (28 September 2026): a login made by `/signup` is deleted when it was never confirmed 7 days after its last sign-up request, or was confirmed more than 30 days ago and still has no venue. Only logins with a sign-up row, no venue, no brand membership, no admin role and no open team invitation qualify, so Peter's logins, invited members and every venue owner are never touched.

The rule lives in one database function, `self_serve_login_is_stale`. `run_data_retention` uses it to list the logins (oldest request first, at most 100 a run) under `self_serve_logins` in its result, outside `rules`: it never deletes a login itself. For each one the cron calls `delete_stale_self_serve_login(user_id)`, which in a single transaction locks the login's sign-up row, applies the whole rule again and, only if it still holds, deletes the row in `auth.users`. A sign-up request takes the same row lock, so it either finishes first (and the login is kept) or waits until the delete is over. Deleting the login also removes its identities and sessions (cascade) and its `user_auth_snapshot` row (trigger), and sets the sign-up row's `user_id` to null, so the row stays for the funnel until its own 24 months are up. Because the delete is done in SQL rather than through the Auth admin API, Supabase writes no `user_deleted` entry in `auth.audit_log_entries` for it (offboarding still deletes through the API).

The response shows `selfServeLogins` with `due`, `deleted`, `skipped` (asked again, was invited, joined a brand or created a venue since the list was made) and `failed`. A failure never fails the run: the login is logged with its user id and the reason, skipped, and tried again the next day, and the operator gets one "Sign-up problem: login_cleanup" email with the count (at most one an hour). A login with rows in `audit_log` cannot be deleted (that foreign key has no delete action), so it fails every day until someone looks at it.

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
- Local test: `supabase/tests/data_retention_verify.sql` inserts rows either side of every cutoff on a local rebuild, runs a dry run, a real run and a second run, and checks exactly the old rows went; `supabase/tests/self_serve_signups_verify.sql` checks which self-serve logins are listed and what the delete does (kept, failed, deleted with its cascades), and `supabase/tests/self_serve_login_delete_lock_verify.sh` checks that a sign-up request holding the row lock makes the delete wait and keep the login. Never run them against production.
