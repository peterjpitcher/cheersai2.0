# PLAN: New customer readiness, Stage 2 (assisted paid launch)

Spec: `tasks/SPEC-new-customer-readiness.md` §2.1 (plans), §4 (lifecycle contracts), §5 Stage 2, §6 (release). Written 2026-09-24.

Goal: you invite a venue, it pays through Stripe (14-day trial, card up front, Starter or Professional, monthly or annual, ex VAT), works within its plan's limits, is held (not deleted) if payment lapses, and can be offboarded by runbook. The Anchor and Orange Jelly are comped and never touched by billing.

## Prerequisites (off-app, with Peter)

- [ ] P1 Stripe account for **Orange Jelly Limited** (the CLI on this machine is linked to The Anchor's account, `the-anchor.pub`; do not use it for CheersAI). Test-mode keys first.
- [ ] P2 Stripe Tax: UK VAT registration number added, prices tax-exclusive.
- [ ] P3 Stripe customer portal settings: plan switching between Starter and Professional (monthly and annual), cancel at period end, payment method update, invoices.
- [ ] P4 Keys in `.env.local` (test) and Vercel (test for Preview, live for Production): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. I create the products and prices in test mode with the CLI once the account is linked.

## Pieces (each its own PR, in this order)

| # | Piece | Waits on | Migration |
|---|---|---|---|
| 2.1 | AI usage logging (every OpenAI call recorded per brand) | nothing | `ai_usage_events` |
| 2.2 | Billing schema (expand only): `billing_customers`, `subscriptions`, `stripe_events`, `accounts.billing_override` (`comped`/`suspended`), The Anchor and Orange Jelly comped | D3 | yes |
| 2.3 | Stripe integration: server-side plan config, Checkout (trial, card, tax, business name and VAT number), signature-verified webhook with event dedupe and reconcile-from-Stripe, portal link, admin "reconcile" | P1 to P4 | no |
| 2.4 | Entitlement: `getBrandEntitlement()` per §4.1 matrix, banner, gate on chargeable actions, behind `BILLING_ENFORCEMENT_ENABLED` (off until 2.5 ships) | D3, 2.2 | no |
| 2.5 | Publishing hold and release per §4.2 (scheduler, QStash handler, legacy edge function), overdue posts held for review on restore | D3, 2.4 | maybe (hold reason) |
| 2.6 | Roles: `account_members.role` (`owner`/`member`, existing rows `owner`), owner-only billing, invites, connections, export; last-owner rule; customer-run invites with plan seat limits | D4 | yes |
| 2.7 | Usage caps from plan (AI generations, published posts, storage), atomic reservation | 2.1 data (2 weeks), 2.2 | yes (counters) |
| 2.8 | Onboarding checklist (profile, Facebook, Instagram, first provider-confirmed post) | nothing | maybe |
| 2.9 | Offboarding runbook plus admin action (cancel, hold, revoke tokens, archive, export on request, hard delete after 30 days) | 2.3 | no |
| 2.10 | Legal: terms (price, renewal, cancellation, refunds), data processing agreement, retention in privacy policy, support address | Peter's wording or solicitor | no |
| 2.11 | Admin: suspend or comp a brand, subscription state, reconcile | 2.2, 2.3 | no |

Release order for enforcement (spec §6): 2.2 expand, 2.3 and 2.4 deployed with enforcement off, confirm The Anchor and Orange Jelly resolve to `comped`, 2.5 deployed, then switch `BILLING_ENFORCEMENT_ENABLED` on.

## Results

- **2.1** `feat/ai-usage-logging` (2026-09-24): built; `trackAiCall()` wraps all four OpenAI call sites (post copy, media tagging, campaign generation, campaign copy correction). Recording never blocks or fails the AI call. Migration applied 2026-09-24 as version `20260924085419` (service-role only, RLS on). Merged as #91, deployed `dpl_E8XuoTwT3unKedxLLw2rXgTvf7ro`. First usage row to be confirmed after the next real generation.
- **2.2** `feat/billing-schema` (2026-09-24): built. Migration `20260924130000_billing_schema.sql` (billing_customers, subscriptions, stripe_events, accounts.billing_override; The Anchor and Orange Jelly comped) awaiting approval. Plan config `src/lib/billing/plans.ts` and the pure D3 resolver `src/lib/billing/entitlement.ts` (7-day past-due grace), not wired to anything yet.
