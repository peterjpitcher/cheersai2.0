# Stripe Pricing Setup

This document outlines how to configure Stripe Prices for our tiers and update environment variables.

## Tiers and Prices (GBP)

Monthly / Annual (10% off annual):

- Starter: £29.99 / £323.89
- Starter + Images: £54.99 / £593.89
- Professional: £59.99 / £647.89
- Professional + Images: £84.99 / £917.89
- Enterprise: Custom (handled via Sales)

## Create Prices in Stripe

1. Log into Stripe Dashboard → Products → Add product (or use existing products) and create Prices:
   - Currency: GBP
   - Billing: Recurring monthly and recurring annual (per tier)
2. Name your Prices clearly (e.g., "Starter Monthly", "Starter Annual").
3. Copy the Price IDs (e.g., price_ABC123...).

## Environment Variables

Set these in `.env.local` (and in Vercel/production env):

```
NEXT_PUBLIC_STRIPE_STARTER_MONTHLY_PRICE_ID=
NEXT_PUBLIC_STRIPE_STARTER_ANNUAL_PRICE_ID=
NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID=
NEXT_PUBLIC_STRIPE_PRO_ANNUAL_PRICE_ID=
NEXT_PUBLIC_STRIPE_STARTER_IMAGES_MONTHLY_PRICE_ID=
NEXT_PUBLIC_STRIPE_STARTER_IMAGES_ANNUAL_PRICE_ID=
NEXT_PUBLIC_STRIPE_PRO_IMAGES_MONTHLY_PRICE_ID=
NEXT_PUBLIC_STRIPE_PRO_IMAGES_ANNUAL_PRICE_ID=
```

## Verification

- Pricing page `/pricing` shows the new tiers.
- Settings → Billing exposes the new tiers (plan cards show prices from PRICING_TIERS).
- Checkout: selecting a plan calls `/api/stripe/create-checkout` and redirects to Stripe Checkout using the Price ID.

## Notes

- Annual pricing uses the 10% discount formula and is hard-coded in `lib/stripe/config.ts`.
- Enterprise remains custom; handle via Sales contact.
- You can mark one tier as `popular` in `PRICING_TIERS` to show a ribbon.
