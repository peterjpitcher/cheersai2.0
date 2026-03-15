---
title: Connections
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/features
  - module/connections
route: /connections
related:
  - "[[Auth & Security]]"
  - "[[External Integrations]]"
  - "[[Reviews]]"
typescript: src/lib/connections/token-exchange.ts
---

← [[_Index]] / [[_Features MOC]]

# Connections

## Overview

The Connections feature manages OAuth tokens for the three social platforms: Facebook, Instagram Business, and Google Business Profile. Users connect each platform to enable publishing and (for GBP) review syncing.

## Connection States

| Status | Meaning |
|--------|---------|
| `active` | Token valid, metadata complete — ready to publish |
| `expiring` | Token nearing expiry (typically Facebook 60-day tokens) |
| `needs_action` | Missing metadata, invalid token, or not yet connected |

Status is derived in `listConnectionSummaries()` via `deriveStatus()`: if metadata is incomplete, status is forced to `needs_action` regardless of token validity.

## Metadata Requirements per Provider

| Provider | Required Metadata Keys | Purpose |
|----------|----------------------|---------|
| Facebook | `pageId` | The specific Facebook Page to publish to |
| Instagram | `igBusinessId`, `pageId` | IG Business Account ID and linked Facebook Page |
| GBP | `locationId` | Canonical Google Business Profile location ID (`locations/{numericId}`) |

The `evaluateConnectionMetadata()` function in `src/lib/connections/metadata.ts` checks for presence of required keys and returns `{ complete, missingKeys }`.

## OAuth Flow

See [[Auth & Security#OAuth Flow (Social Connections)]] for the sequence diagram.

### Facebook / Instagram

1. User clicks Connect → `startConnectionOAuth()` creates an `oauth_states` row and returns the Meta OAuth URL
2. User authorises via Facebook → callback `/api/oauth/[provider]/callback` stores the `auth_code` in `oauth_states`
3. `completeConnectionOAuth()` is called client-side with the `state` UUID
4. `exchangeProviderAuthCode()` runs:
   - Exchanges code for a short-lived user token
   - Upgrades to a long-lived token (~60 days) via `fb_exchange_token`
   - Fetches all managed Facebook Pages including linked Instagram accounts
   - Selects the matching page (by stored `pageId`) or defaults to first
5. Token + metadata stored in `social_connections`

### Google Business Profile

1. Same OAuth state flow
2. `exchangeGoogleCode()` exchanges auth code for access + refresh tokens (refresh token is stored)
3. `resolveGoogleBusinessLocation()` calls the GBP API to resolve the canonical `locationId`
   - Result is cached in-memory for 5 minutes to avoid quota burns
   - If rate-limited during OAuth, falls back to existing canonical `locationId` from metadata

> [!WARNING] GBP Location ID
> GBP location IDs must be stored in canonical form: `locations/{numericId}` (not `locations/ChIJ...` place IDs). The `normalizeCanonicalGbpLocationId()` function in `src/lib/gbp/location-id.ts` normalises IDs and validates format. Non-canonical IDs cause persistent rate-limit loops because the reviews API rejects them.

## Token Refresh

- **Facebook/Instagram**: Tokens last ~60 days. No automatic refresh — users must reconnect.
- **GBP**: Has `refresh_token`. `refreshGoogleAccessToken()` in `src/lib/gbp/reviews.ts` exchanges refresh tokens for new access tokens during the review sync cron.

## Connection Cards UI

`src/features/connections/connection-cards.tsx` renders one card per provider showing:
- Connection status badge
- Display name (Facebook Page name, IG username, GBP location name)
- Last synced date
- Token expiry warning
- Reconnect / update metadata actions
- Diagnostics info (if `ENABLE_CONNECTION_DIAGNOSTICS=true`)

## GBP-Specific: Location ID Validation

The Connections page includes a form to manually input the GBP Location ID. `getGbpLocationIdValidationError()` validates the format before saving. On save, `normalizeCanonicalGbpLocationId()` normalises the ID to `locations/{numericId}` form.
