-- Billing schema, expand only (SPEC-new-customer-readiness §4.3, Stage 2 piece 2.2).
--
-- Ownership of fields:
--   * billing_customers, subscriptions: written only by the Stripe webhook and
--     the reconcile-from-Stripe path (service role). Rows mirror Stripe.
--   * stripe_events: one row per Stripe event id, so a redelivered event is
--     processed once.
--   * accounts.billing_override: app-owned operator state. 'comped' brands use
--     the app for free; 'suspended' brands are held by the operator. It takes
--     precedence over Stripe (see src/lib/billing/entitlement.ts).
--
-- Nothing reads these tables yet; enforcement ships later behind a flag. The
-- Anchor and Orange Jelly are comped here so they are never affected.
--
-- All tables are service-role only.
--
-- Rollback (after reverting any code that reads them):
--   alter table public.accounts drop column if exists billing_override;
--   drop table if exists public.subscriptions, public.billing_customers, public.stripe_events;

create table if not exists public.billing_customers (
  account_id          uuid primary key references public.accounts(id) on delete cascade,
  stripe_customer_id  text not null unique,
  created_at          timestamptz not null default now()
);

create table if not exists public.subscriptions (
  stripe_subscription_id  text primary key,
  account_id              uuid not null references public.accounts(id) on delete cascade,
  stripe_customer_id      text not null,
  status                  text not null check (status in (
                            'trialing', 'active', 'past_due', 'canceled', 'unpaid',
                            'incomplete', 'incomplete_expired', 'paused')),
  plan                    text not null check (plan in ('starter', 'professional', 'group')),
  billing_interval        text not null check (billing_interval in ('month', 'year')),
  stripe_price_id         text not null,
  trial_end               timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  canceled_at             timestamptz,
  -- Stripe's own timestamp for the state stored here; an older event never
  -- overwrites a newer state (events can arrive out of order).
  stripe_state_at         timestamptz not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists subscriptions_account_idx on public.subscriptions (account_id);

create table if not exists public.stripe_events (
  id            text primary key,
  type          text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

alter table public.accounts
  add column if not exists billing_override text
  check (billing_override in ('comped', 'suspended'));

comment on column public.accounts.billing_override is
  'Operator billing state: comped (free) or suspended (held). Null means Stripe decides. App-owned, never written by the Stripe webhook.';

-- The Anchor and Orange Jelly use CheersAI free of charge.
update public.accounts
set billing_override = 'comped'
where id in ('91fda684-2801-4abb-980e-f42cec017cef', '49d44b7d-29ac-4ea8-8b12-578158f18fe6');

alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;

revoke all on public.billing_customers, public.subscriptions, public.stripe_events from anon, authenticated;
grant select, insert, update, delete on public.billing_customers, public.subscriptions, public.stripe_events to service_role;
