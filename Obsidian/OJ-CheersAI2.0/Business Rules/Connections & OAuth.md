---
title: Connections & OAuth Rules
created: 2026-03-14
last_updated: 2026-03-14
status: current
tags:
  - type/reference
  - section/business-rules
  - module/connections
related:
  - "[[Connections]]"
  - "[[Reviews]]"
  - "[[Auth & Security]]"
---

← [[_Index]] / [[_Business Rules MOC]]

# Connections & OAuth Rules

## Connection Validity

A connection is only `active` if:
1. The access token is present
2. Required metadata is present and complete
3. The token has not expired (or the provider does not use expiry)

If any condition fails, status is forced to `needs_action`.

## Provider Metadata Requirements

| Provider | Required Keys | Notes |
|----------|--------------|-------|
| Facebook | `pageId` | Which Facebook Page to publish to |
| Instagram | `pageId` + `igBusinessId` | Facebook Page token is used for IG publishing |
| GBP | `locationId` | Must be canonical form only |

## GBP Location ID Rules

- Must be `locations/{numericId}` format
- `locations/ChIJ...` (place IDs) are invalid and must be rejected
- Normalisation via `normalizeCanonicalGbpLocationId()` strips `https://` prefixes and reconstructs canonical form
- The canonical ID is discovered from the GBP Business Info API during OAuth or manual metadata entry
- Once canonical ID is stored, it must not be replaced with a non-canonical form
- During OAuth, if GBP API is rate-limited, the existing canonical ID is preserved (not cleared)

## OAuth State Lifecycle

- Unused states expire after **30 minutes** (if user never completes OAuth)
- Used states expire after **24 hours**
- Cleanup runs on every new `startConnectionOAuth()` call
- State must match exactly when calling `completeConnectionOAuth()` — no fuzzy matching

## Token Storage

- Access tokens stored in `social_connections.access_token` — encrypted at rest by Supabase
- Refresh tokens stored in `social_connections.refresh_token` — GBP only
- Facebook/Instagram tokens do not use refresh tokens (60-day page tokens, reconnect required on expiry)

## GBP Rate Limiting

- GBP API enforces per-minute and per-day quotas
- On 429 response, `Retry-After` header is parsed to determine wait time
- Rate limit state is stored in `social_connections.metadata.rateLimitedUntil`
- Cron sync skips connections within their rate limit window
- UI surfaces the countdown ("Rate limited — retry in X minutes")

## Notification Rules

On connection events, a `notifications` row is inserted:
- `connection_reconnected` — OAuth completed successfully
- `connection_metadata_updated` — metadata saved (complete or incomplete)
- `connection_needs_action` — connection check failed (via diagnostics)
