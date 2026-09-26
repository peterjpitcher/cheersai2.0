# Runbook: Stripe billing

CheersAI bills through the **Orange Jelly Limited** Stripe account. That account is shared with the Orange Jelly management app, so everything CheersAI creates is tagged `app=cheersai`, CheersAI always passes its own customer portal configuration, and the webhook ignores any event that is not about one of its own customers. Code: `src/lib/billing/`, the webhook at `src/app/api/stripe/webhook/route.ts`.

The Stripe CLI on Peter's machine is linked to The Anchor's account (`the-anchor.pub`). Never use it for CheersAI without an explicit `--api-key` for Orange Jelly Limited.

## Environment variables

Set in Vercel, per environment. Production must use live-mode values; preview and local use test-mode values. Never commit a real value (`.env.example` holds placeholders and the test-mode ids only).

| Variable | What it is |
|---|---|
| `STRIPE_SECRET_KEY` | Secret key (`sk_...`) or restricted key (`rk_...`). In production (`VERCEL_ENV=production`) only `sk_live_` or `rk_live_` is accepted; a test key there is treated as "billing not set up" and logged as an error, so test customers can never land in the production database. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret (`whsec_...`) of the webhook endpoint for that environment. |
| `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_ANNUAL`, `STRIPE_PRICE_PROFESSIONAL_MONTHLY`, `STRIPE_PRICE_PROFESSIONAL_ANNUAL` | Price ids Checkout sells. Reconcile maps a subscription's price to a plan by these ids first, then by the price's metadata (`app=cheersai`, `plan`, `interval`) or lookup key (`cheers_<plan>_<monthly|annual>`), so a replaced or grandfathered price keeps working if it carries either. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | CheersAI's own customer portal configuration (`bpc_...`). The account default portal belongs to the management app. |
| `OPERATOR_ALERT_EMAIL` | Where operator alerts go (already required in production). |
| `VERCEL_ENV` | Set by Vercel itself; nothing to configure. |

Missing values never break the build: Checkout and the portal say "Billing is not set up yet" and the webhook answers 503 (Stripe retries, nothing is lost).

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

## Testing in test mode with the Stripe CLI

Use Orange Jelly Limited's **test-mode** key only (never `--live`):

```bash
stripe listen \
  --api-key "$STRIPE_TEST_SECRET_KEY" \
  --forward-to localhost:3000/api/stripe/webhook \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed,invoice.paid,invoice.payment_failed,invoice.finalization_failed
```

Put the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` in `.env.local` and restart `npm run dev`. Then go through a real test Checkout from Settings, Billing with card `4242 4242 4242 4242`. `stripe trigger` creates customers CheersAI does not know, so the webhook correctly ignores those events.

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
