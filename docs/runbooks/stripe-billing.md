# Runbook: Stripe billing

CheersAI bills through the **Orange Jelly Limited** Stripe account. That account is shared with the Orange Jelly management app, so everything CheersAI creates is tagged `app=cheersai`, CheersAI always passes its own customer portal configuration, and the webhook ignores any event that is not about one of its own customers. Code: `src/lib/billing/`, the webhook at `src/app/api/stripe/webhook/route.ts`.

Check which account the Stripe CLI on Peter's machine is linked to before using it (`~/.config/stripe/config.toml`, `display_name` and `account_id`): on 28 September 2026 it was Orange Jelly Limited (`acct_1HUtLSIMsxxxvzCC`); earlier it was The Anchor's account (`the-anchor.pub`). Never use it for CheersAI while it points at another account, and use test mode only (never `--live`) for testing.

## Environment variables

Set in Vercel, per environment. Production must use live-mode values; preview and local use test-mode values. Never commit a real value (`.env.example` holds placeholders and the test-mode ids only).

| Variable | What it is |
|---|---|
| `STRIPE_SECRET_KEY` | Secret key (`sk_...`) or restricted key (`rk_...`). In production (`VERCEL_ENV=production`) only `sk_live_` or `rk_live_` is accepted; a test key there is treated as "billing not set up" and logged as an error, so test customers can never land in the production database. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret (`whsec_...`) of the webhook endpoint for that environment. |
| `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_ANNUAL`, `STRIPE_PRICE_PROFESSIONAL_MONTHLY`, `STRIPE_PRICE_PROFESSIONAL_ANNUAL` | Price ids Checkout sells. Reconcile maps a subscription's price to a plan by these ids first, then by the price's metadata (`app=cheersai`, `plan`, `interval`) or lookup key (`cheers_<plan>_<monthly|annual>`), so a replaced or grandfathered price keeps working if it carries either. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | CheersAI's own customer portal configuration (`bpc_...`). The account default portal belongs to the management app. |
| `TRIAL_CARD_HASH_KEY` | Key for the repeat free-trial check (below): exactly 64 hex characters, made with `openssl rand -hex 32`, Production only. Checkout, reconcile and the webhook need it; a missing or malformed key counts as "billing not set up" (logged once, without the key). Keep it secret and do not rotate it casually: a new key makes every stored card code unmatchable, so a card that had a trial could have another. |
| `OPERATOR_ALERT_EMAIL` | Where operator alerts go (already required in production). |
| `VERCEL_ENV` | Set by Vercel itself; nothing to configure. |

Missing values never break the build: Checkout and the portal say "Billing is not set up yet" and the webhook answers 503 (Stripe retries, nothing is lost). The portal does not need `TRIAL_CARD_HASH_KEY`, so an owner can always manage an existing plan.

## The webhook endpoint

Create one endpoint per Stripe mode (live for production, test for preview), in the Stripe dashboard under Developers, Webhooks, Add endpoint:

- **URL:** `https://cheers.orangejelly.co.uk/api/stripe/webhook` (live). Never the retired `cheersai.uk` host: its redirect is browser-only and would lose the delivery. A test-mode endpoint points at the preview deployment's URL instead.
- **API version:** `2026-08-26.dahlia`, the version the code pins (`STRIPE_API_VERSION` in `src/lib/billing/stripe.ts`). Change both together.
- **Events to send**, exactly these and no others:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.paused`
  - `customer.subscription.resumed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.finalization_failed`
- **Do not enable `invoice.created` or any `customer.*` event** (for example `customer.created`, `customer.updated`). The account is shared with the management app: when any endpoint listens for `invoice.created`, Stripe waits for a successful answer (for up to 72 hours) before it finalises an automatic invoice, so a slow or failing endpoint here would delay invoice finalisation for the whole account. Customer events add load for nothing CheersAI uses.

Then copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` for that environment and redeploy. Check the first deliveries in the dashboard answer 200.

The code's list is `SUBSCRIBED_EVENT_TYPES` in `src/lib/billing/webhook.ts`; a test fails if this runbook and the code disagree.

### What the webhook does

- Verifies the `Stripe-Signature` header against the raw body (400 if it fails).
- Records the event id in `stripe_events`; a redelivery of a processed event is a no-op, a redelivery of a failed one runs again.
- Ignores events about customers that are not in `billing_customers` (the management app's), still recording them.
- For subscription, checkout and paid or failed invoice events, re-reads the brand's subscriptions from Stripe (never trusting the payload) and stores them. An older read never overwrites a newer one. Stored live rows Stripe no longer lists are marked cancelled.
- For `invoice.finalization_failed`, emails the operator (nothing is charged until the invoice is fixed and finalised in Stripe).
- Answers 500 when anything fails, so Stripe retries for up to three days, and emails the operator.

### Operator alerts

All go to `OPERATOR_ALERT_EMAIL`, at most one of each kind per brand per 24 hours (events for unknown customers share one bucket), recorded in `admin_audit`:

| Alert | Action in `admin_audit` | What to do |
|---|---|---|
| Stripe webhook failing | `operator_stripe_webhook_alert` | Look at `stripe_events` rows with an `error`, fix the cause, then re-sync the brand. |
| Invoice could not be finalised | `operator_stripe_invoice_alert` | Open the invoice in Stripe, fix the cause (usually the customer's address or tax details), finalise it. |
| Possible double billing | `operator_stripe_double_billing_alert` | The brand's customer has more than one live CheersAI subscription. Cancel the extra one in Stripe (refund if it charged), then re-sync. |

Two more come from the repeat free-trial check (below). They are not throttled, because each is about one subscription and is sent once:

| Alert | Record | What to do |
|---|---|---|
| Free trial refused: card already used for a trial | `trial_refused_repeat_card` in `admin_audit` | Nothing, unless the owner contacts you. The trial was cancelled with nothing charged, and Billing offers them a paid plan straight away. |
| Free trial started with no card to check | a `no_card` row in `trial_card_checks` | The subscription has no card payment method (for example Link), so the check could not run and the trial carries on. Look at it in Stripe and cancel by hand if this business has had a trial before. |

And one throttled like the Stripe alerts above (at most one a day per brand):

| Alert | Action in `admin_audit` | What to do |
|---|---|---|
| A refused free trial is no longer on its Stripe customer | `operator_stripe_trial_card_alert` | An unfinished refusal's subscription was moved to another customer or deleted in Stripe. Find it in Stripe, cancel it if it still runs, then set `cancelled_at` on its `trial_card_checks` row. |

## Repeat free trials, checked by card

One free trial per card, across every brand (spec §4.7, decisions L6 and P5). Code: `src/lib/billing/trial-card-check.ts`, called by the reconcile after the current subscription row is stored, so the webhook, "Check again" and admin re-sync all run it. Table: `trial_card_checks` (migration `20260928200000_trial_card_checks.sql`), service role only, kept 24 months (the data-retention job).

- **Only free trials that started with their subscription are checked** (Stripe's `trial_start` within a minute of `created` or `start_date`, as Checkout's trial is). A paid subscription moved into a trial later, for example a free month you give in the Stripe Dashboard, is left alone and nothing is recorded. For a checked trial, the default payment method is read from Stripe (expanded), and its card fingerprint is turned into a code: HMAC-SHA256 with `TRIAL_CARD_HASH_KEY`. No card number, fingerprint, brand or last four digits is stored, logged or emailed. Any other subscription costs one or two database reads and no Stripe call, so comped brands are unaffected. A trial you create by hand in the Dashboard starts with its subscription, so it is checked like any other.
- **The first trial on a card** is recorded as `first_trial`. A partial unique index allows one `first_trial` per code, which is the whole cross-brand check.
- **A later trial on the same card**, on any brand (a second venue of the same business included), is recorded as `repeat_refused`. The reconcile that recorded it cancels the trial in Stripe at once (`invoice_now: false`, `prorate: false`: nothing is charged in a trial), stores the cancelled subscription, emails the operator, writes `trial_refused_repeat_card` to `admin_audit` (once per subscription, however many retries) and then sets `cancelled_at`. Before refusing, it confirms a first trial really exists for that card code. The owner sees "This card has already been used for a Cheers free trial, so this plan cannot start with one. Start your plan today to carry on." with the usual plan picker, which offers no trial because the brand has subscribed before.
- **No card** on the subscription: `no_card` (its `card_hash` is `none`) and an operator email; the trial carries on.
- **Trials Stripe created before 13:00 London time on 28 September 2026** (`TRIAL_CARD_CHECK_STARTS_AT`, when the check was written) are recorded when their card is free but never refused. Production had no trialing subscription then; before the check deploys, confirm it still has none (`select count(*) from subscriptions where status = 'trialing'` must be 0), because a trial started between that moment and the deploy would be checked on its next reconcile.
- **Races.** Stripe's events for one Checkout reconcile at the same time. The table's keys decide: exactly one reconcile records the outcome and only that one cancels. Any other reconcile of the same subscription (including the ones our own cancellation triggers) waits up to 20 seconds for it to finish.
- **Failures.** A Stripe or database error fails the reconcile: the webhook answers 500, Stripe redelivers, and the "Stripe webhook failing" alert goes out. The trial runs meanwhile. A refusal left unfinished (`repeat_refused` with no `cancelled_at`) is finished by the first reconcile at least 10 minutes after it was recorded (a redelivery, Check again or Re-sync from Stripe); an earlier one waits, then fails again so Stripe redelivers later. Only one reconcile may take over in each 10-minute window (a `trial_card_finish:<subscription id>` key in `auth_rate_limits`), so retries arriving together send one cancel, one email and one audit row. If the owner has started a paid plan meanwhile, the old refusal is stored as older than the paid subscription, so the brand stays active. If the refused subscription is no longer on the brand's Stripe customer, the operator gets the alert above and the reconcile carries on. If a refused trial is somehow no longer a trial by then (it was charged), the reconcile fails with "cancel or keep it by hand": decide in Stripe, then set `cancelled_at` on its row.
- **Wallets.** Apple Pay and Google Pay can give a device-specific card fingerprint, so the same physical card through a wallet may not match. Accepted: the operator sees every refusal.

Read only, in the Supabase SQL editor:

```sql
-- Recent checks, newest first (no card data is stored).
select t.created_at, a.business_name, t.outcome, t.cancelled_at, t.stripe_subscription_id
from trial_card_checks t join accounts a on a.id = t.account_id
order by t.created_at desc limit 50;

-- Which brand had the first trial on the card a refused subscription used.
select a.business_name, f.stripe_subscription_id, f.created_at
from trial_card_checks r
join trial_card_checks f on f.card_hash = r.card_hash and f.outcome = 'first_trial'
join accounts a on a.id = f.account_id
where r.stripe_subscription_id = '<refused sub_...>';
```

## Customer portal configuration

CheersAI's portal configuration (the id in `STRIPE_PORTAL_CONFIGURATION_ID`) must have:

- plan switching between the four CheersAI prices (Starter and Professional, monthly and annual), upgrades prorated and invoiced immediately (`proration_behavior=always_invoice`), downgrades at the end of the period (`schedule_at_period_end` on a decreasing amount);
- **`trial_update_behavior=continue_trial`**. Without it, changing plan during the free trial ends the trial and charges the full price that day, which contradicts the Billing page ("nothing is charged until the 14-day trial ends"). Found in the end-to-end test on 2026-09-26;
- cancel at period end, payment method update, invoice history, and name, address, email and tax id updates.

Test mode: `bpc_1UJs0QIMsxxxvzCCRkUnIFH8` has all of this. Live: `bpc_1UKYyQIMsxxxvzCC8JoU8Fpd`, created the same way on 2026-09-28.

## Live setup (done 2026-09-28)

Approved by Peter (question 20). Everything below was read back from Stripe after it was created.

| Item | Live value |
|---|---|
| Products | Starter `prod_SsuS7eXhpSaezB`, Professional `prod_SsuTnQek82Vi6e`: metadata `app=cheersai` and `plan`, tax code `txcd_10103001`, statement descriptor `CHEERS ORANGE JELLY` |
| Prices (GBP, ex VAT, `tax_behavior=exclusive`, lookup keys `cheers_{plan}_{monthly,annual}`) | Starter monthly `price_1UKYyGIMsxxxvzCCgmOtcvMB` (2999), Starter annual `price_1UKYyHIMsxxxvzCCn9CDAIwp` (32389), Professional monthly `price_1UKYyIIMsxxxvzCCqq0PkMaX` (5999), Professional annual `price_1UKYyJIMsxxxvzCCdQVuE17z` (64789) |
| Old prices | The four VAT-inclusive and four image-generation prices archived (no subscriptions on them) |
| Portal | `bpc_1UKYyQIMsxxxvzCC8JoU8Fpd`, `continue_trial`, upgrades `always_invoice`, downgrades at period end, cancel at period end |
| Stripe Tax | GB standard registration `taxreg_1UKYyRIMsxxxvzCCdBieKRyk`, active; account tax ID `txi_1UKYySIMsxxxvzCCANqfHTTU` (GB315203647); invoices display tax IDs by taxable location |
| Webhook | `we_1UKYyUIMsxxxvzCCyBApA6gk` to `https://cheers.orangejelly.co.uk/api/stripe/webhook`, API version `2026-08-26.dahlia`, the nine events listed above |
| Vercel production | the four `STRIPE_PRICE_*`, `STRIPE_PORTAL_CONFIGURATION_ID`, `STRIPE_SECRET_KEY` (restricted `rk_live_` key "CheersAI production": Checkout Sessions, Customers and Customer Portal write; Subscriptions, Prices and Products read; the repeat free-trial check also needs PaymentMethods read and Subscriptions write, see below) and `STRIPE_WEBHOOK_SECRET` |
| Emails | Stripe sends upcoming-renewal, trial-ending (7 days) and expiring-card emails |

Checks after the production redeploy (`dpl_9YTot6wLnzgnZQU59rnNqkLZ5WQv`): the webhook answers 400 to a missing or wrong signature (503 before the secrets were set), and a correctly signed self-test event for an unknown customer was accepted and ignored (its `stripe_events` row was then deleted). The restricted key's permissions were checked with requests against ids that do not exist, so nothing was created. No real live Checkout has been run yet.

The Stripe CLI's own live key was given write access to Products, Prices, Customer Portal, Tax IDs, Tax registrations and Webhook Endpoints for the setup; it expires on its own after 90 days.

### Before the repeat free-trial check deploys (PR 7)

In this order, each by Peter:

1. Apply `supabase/migrations/20260928200000_trial_card_checks.sql` (it only adds the table and one retention rule; nothing reads them yet).
2. On the "CheersAI production" restricted key, add two permissions: **PaymentMethods: Read** (to read the trial's card fingerprint) and **Subscriptions: Write** (to cancel a refused trial). Without the first, every trial's reconcile fails with a permission error (webhook 500 and an alert) and the trial runs unchecked; without the second, a refused trial cannot be cancelled and fails the same way.
3. Add `TRIAL_CARD_HASH_KEY` to Vercel **Production** only: `openssl rand -hex 32`, pasted straight into Vercel, never into a file or chat. Preview needs none.
4. Just before merging, confirm production still has no trialing subscription (read only: `select count(*) from subscriptions where status = 'trialing'` is 0; see `TRIAL_CARD_CHECK_STARTS_AT` below).
5. Merge and deploy. Until the key is there, Checkout says "Billing is not set up yet" and the webhook answers 503, which Stripe retries.

## Terms acceptance at Checkout

Checkout shows a required tick box (`consent_collection.terms_of_service: 'required'`) with our own text (`custom_text.terms_of_service_acceptance`): the owner accepts the Terms of Service and the Data Processing Agreement, with links to `/terms` and `/data-processing` on `NEXT_PUBLIC_SITE_URL`, and the version from `LEGAL_VERSION` in `src/lib/legal/company.ts`. Stripe records the acceptance on the Checkout Session (`consent.terms_of_service = 'accepted'`).

Stripe refuses the tick box unless a terms of service URL is set in the Dashboard (Settings, Business, Public details). Both modes already have one: test mode accepted a session with the tick box on 2026-09-27, and live mode's Public details list a terms of service URL (checked in the Dashboard the same day). That URL is account-wide and the account is shared with the management app, so leave it as it is: the tick box's own text links to the Cheers terms and DPA. Keep a URL set, or every Checkout with the tick box fails to start.

When the terms, privacy notice or DPA change, bump `LEGAL_VERSION` and `LEGAL_UPDATED` together, so new acceptances name the new version.

## Testing in test mode (never against production)

`.env.local` points at the **production** Supabase project, and so do Preview deployments. Never run a test Checkout there: it writes test customers and subscriptions into the live billing tables. Test against the local Supabase stack instead:

1. `supabase start` (give it free ports in `supabase/config.toml` if another project's stack holds the defaults; do not commit that change), then `npm run db:rebuild`.
2. The local chain differs from production in three ways that matter for billing, so fix them locally only: grant the table privileges production has (`service_role` has all; see `information_schema.role_table_grants` on production), add `accounts.email text`, and `alter type content_status add value 'held'` (production's `publish_jobs.status` is text with a CHECK; the local chain still has the enum).
3. Create a local owner, brand and `account_members` row with the local service-role key.
4. Run the dev server with the local Supabase URL and keys, Orange Jelly's **test-mode** Stripe key, the test price and portal ids, and the forwarding secret from:

```bash
stripe listen \
  --forward-to localhost:3100/api/stripe/webhook \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed,invoice.paid,invoice.payment_failed,invoice.finalization_failed
```

5. Settings, Billing, start the trial, pay with `4242 4242 4242 4242`. For a failed payment, attach `pm_card_chargeCustomerFail` as the subscription's default payment method and end the trial (`trial_end=now`). `stripe trigger` creates customers CheersAI does not know, so the webhook correctly ignores those events. `stripe subscriptions cancel` waits for a confirmation prompt; use `stripe delete /v1/subscriptions/<id> --confirm`.

### Verified end to end (2026-09-26, test mode, local stack)

| Step | Result |
|---|---|
| Starter monthly trial through Checkout | Checkout showed 14 days free, £0.00 today, £29.99 + £6.00 VAT from 10 Oct; webhooks 200; app: "Free trial of Starter, billed monthly, until 10 October 2026" |
| Upgrade to Professional in the portal during the trial | With `continue_trial`: £0.00 today, £71.99 from 10 Oct; app: "Free trial of Professional", "Your free trial uses Starter limits" |
| Trial ends, card declines | `past_due`; app: "Update your payment details by 3 October 2026" (7 days from the start of the unpaid period) |
| Pay the invoice with a working card | £71.99 paid (£12.00 VAT); `active` |
| Cancel in the portal | app: "Professional, billed monthly. Ends on 26 October 2026" |
| Subscription deleted | app: "Your subscription has ended", no second free trial offered |
| Admin, Re-sync from Stripe | "Subscription updated from Stripe", audited as `stripe_resync` |

### Repeat free-trial check, verified (2026-09-28, test mode, local stack)

The tool browser could not open the hosted Checkout page, so the app's "Start 14-day free trial" created the customer and Checkout Session and the subscription was then created through the API as Checkout does (a real Checkout's `customer.subscription.created` of 2026-09-26 shows Checkout sets the card as `default_payment_method` at creation). `stripe listen` forwarded the webhooks; a mock Resend captured the emails.

| Step | Result |
|---|---|
| First trial, card 4242 | `first_trial`; webhooks 200 (two at once for one subscription) |
| Same card on a second brand | `repeat_refused`; cancelled in Stripe at once (one cancel request, invoice total £0.00, nothing paid); `trial_refused_repeat_card` audited; one operator email with no card details; Billing: "This card has already been used for a Cheers free trial..." with "Continue to payment", whose Checkout Session is £29.99 today (no trial) |
| Different card (Mastercard 4444) | `first_trial`; Billing: "Free trial of Starter, billed monthly, until 12 October 2026." |
| No card | `no_card`; operator email; trial carries on |
| Database refuses the insert | webhook 500, "Stripe webhook failing" email; after the fix, a redelivery answers 200 and records `first_trial` |
| Operator email fails during a refusal | trial cancelled and stored cancelled; the three reconciles answer 500 (the other two after waiting 20 seconds, without cancelling); a redelivery inside 10 minutes waits and fails again; one after 10 minutes finishes it (email, `cancelled_at`) with no second cancel |
| Five reconciles of one new trial at once, plus its webhooks | one `repeat_refused`, one cancel request, one audit row, one email |
| Two brands, one new card, at once (plus webhooks) | one `first_trial`, one `repeat_refused`, one cancel request |
| Comped brand whose only subscription is cancelled | only `subscriptions.list` called; nothing written |
| After the review fixes: a paid subscription (card 4242, which had a first trial) moved into a 30-day trial 85 seconds after creation | `trial_start` later than `created`; both events 200; nothing recorded, no card lookup, no cancel |
| After the review fixes: refusal left unfinished (email failed), owner pays on a new subscription inside the window, its two events redelivered together after 10 minutes | Inside the window the events answer 500 (they wait for the unfinished refusal) but the paid row is already stored, so Billing shows "Starter, billed monthly. Renews on 28 October 2026."; after the window both answer 200, one takes over (one email, one audit row, no second cancel) and the old cancelled row is stored 1 ms older than the paid one, so the brand stays active |

## Re-syncing a brand

Admin, Billing card, **Re-sync from Stripe** on the brand's row. It runs the same reconcile the webhook runs, releases the brand's future held posts if it may publish again, and is audited as `stripe_resync`. Use it after an alert, after changing a subscription by hand in Stripe, or after a webhook outage. It is always safe to repeat.

## Free (comped) and suspended brands

- Setting a brand to **Free** is refused while it still has a trialing, active, past-due, unpaid, paused or incomplete CheersAI subscription, stored or in Stripe: "This brand still has a Stripe subscription. Cancel it in Stripe first, then set it to Free." Otherwise Stripe would keep charging a brand the app treats as free.
- Setting a brand to **Suspended** is allowed, but the admin page warns that Stripe keeps billing until the subscription is cancelled in Stripe.
- If a Free brand somehow still has a live subscription, its owners still see Manage billing so they can cancel it.

## Rotating keys

Follow `docs/runbooks/credential-rotation.md` for the general pattern. For Stripe:

1. **Secret key:** in Stripe, create a new key (or roll the existing one with a short expiry on the old one). Update `STRIPE_SECRET_KEY` in Vercel for that environment and redeploy. Check Settings, Billing loads without "Billing is not set up yet" and re-sync one brand from the admin page. Then expire the old key in Stripe.
2. **Webhook signing secret:** in Stripe, roll the endpoint's secret, keeping the old one valid for a while (Stripe allows up to 24 hours). Update `STRIPE_WEBHOOK_SECRET` in Vercel and redeploy. Confirm new deliveries answer 200 in the dashboard before the old secret expires. A delivery that failed with 400 in between is retried by Stripe; after the change, re-sync any brand that changed in that window.

## Deploy order for the period-start column

Migration `supabase/migrations/20260926120000_subscriptions_period_start.sql` adds `subscriptions.current_period_start` (past-due grace runs 7 days from the start of the unpaid period). Apply it before deploying the app code that writes it. The `publish-queue` edge function reads it but falls back to the old columns if it is missing, so it can be deployed before or after.
