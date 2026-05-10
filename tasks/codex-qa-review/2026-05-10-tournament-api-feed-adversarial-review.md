# Adversarial Review: Tournament API Feed

**Date:** 2026-05-10
**Mode:** C (Spec Compliance)
**Scope:** `docs/superpowers/specs/2026-05-10-tournament-api-feed-design.md`
**Pack:** `tasks/codex-qa-review/2026-05-10-tournament-api-feed-review-pack.md`
**Reviewers:** Assumption Breaker, Spec Trace Auditor, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk

## Executive Summary

Five Codex reviewers analysed the tournament API feed design spec against the project codebase. No implementation code exists yet (this is a spec review). The spec is directionally sound — read-only, curated fields, per-tournament API key, rate limited — but has three material spec defects that would cause real problems if implemented as-written: (1) public caching on an authenticated endpoint without `Vary`, (2) browser CORS conflicting with the "shared secret" API key model, and (3) rate limiting ordered after auth validation, leaving the DB open to invalid-key flooding.

## What Appears Solid

- **Read-only scope** with all writes through dashboard server actions — correct separation
- **Curated response fields** explicitly excluding internal account, media, content pipeline, and config data
- **Nullable `feed_api_key`** with partial unique index — clean enable/disable model without destructive schema changes
- **`crypto.randomBytes(16)`** for key generation — 128 bits of entropy, sufficient for this use case
- **UUID validation** on path parameter — prevents injection via malformed input

## Critical Risks

### CR-1: Cache + Auth Conflict (5/5 reviewers flagged)
`Cache-Control: public, max-age=300` on an API-key-authenticated endpoint without `Vary: x-api-key`. A shared cache (CDN, reverse proxy) could store a valid 200 response and serve it to subsequent requests with no key or a wrong key, bypassing auth entirely. After key rotation/disable, cached data persists for up to 5+ minutes.

**Fix:** Use `s-maxage=300, stale-while-revalidate=60` (CDN-directed, no browser cache). Add `Vary: x-api-key`. Only set cache headers on 200 responses — errors get `no-store`.

### CR-2: Browser CORS vs Shared Secret Contradiction (4/5 reviewers flagged)
The spec calls the API key a "shared secret" but enables wildcard CORS for browser-side fetching. If a brand site fetches from client-side JavaScript, every visitor sees the key in network requests.

**Fix:** Explicitly reclassify the key as a **public access token** (not a secret). The data is inherently public (displayed on the brand site). The key exists to prevent casual scraping and identify the consumer, not to protect confidential data. Remove "shared secret" language.

### CR-3: Rate Limit After Auth (3/5 reviewers flagged)
The architecture diagram orders API key validation before rate limiting. An attacker can flood the endpoint with invalid keys, forcing a DB lookup per request without ever hitting the 429 gate.

**Fix:** Rate limit FIRST (before any DB query), then validate UUID format, then look up tournament + key.

## Spec Defects

| ID | Finding | Severity | Fix |
|----|---------|----------|-----|
| SD-1 | Error table missing 500 for DB/query failures | Medium | Add 500 response with stable JSON error body |
| SD-2 | Error precedence ambiguous (disabled feed vs wrong key) | Medium | Define exact order: rate limit → UUID → tournament+key → data |
| SD-3 | "No internal IDs" claim contradicts response including `id` fields | Medium | Remove claim; document that UUIDs are public stable identifiers |
| SD-4 | Date range validation incomplete (inverted ranges, timezone) | Medium | Specify: `from > to` returns 400; dates normalised to UTC |
| SD-5 | Server action return type diverges from project convention | Low | Use `{ success, error?, apiKey? }` pattern |
| SD-6 | Key regeneration has no double-submit guard | Low | Spec loading state on button during pending |

## Architecture & Integration Defects

| ID | Finding | Severity | Fix |
|----|---------|----------|-----|
| AI-1 | Rate limit key is IP-only — cross-tournament collision risk | Medium | Use `feed:{tournamentId}:{ip}` as limiter key |
| AI-2 | Spec doesn't mention reusing existing `mapFixture` from queries.ts | Low | Reuse existing mappers; don't duplicate |

## Security & Data Risks

| ID | Finding | Severity | Decision |
|----|---------|----------|----------|
| SR-1 | API key stored in plaintext | Medium | **Accepted** — low-sensitivity read-only data, key shown in UI, can be regenerated. Document trade-off. |
| SR-2 | Fixture UUIDs exposed could correlate with dashboard endpoints | Low | **Accepted** — all dashboard endpoints have proper auth checks. UUIDs are not secrets. |
| SR-3 | Cache revocation lag after key disable | Low | **Accepted** — max 5 min lag on non-sensitive public fixture data |

## Recommended Fix Order

1. **CR-2** — Reclassify key as public access token (language change, informs all other decisions)
2. **CR-3** — Reorder: rate limit before auth (affects architecture diagram and implementation)
3. **CR-1** — Fix cache headers: `s-maxage`, `Vary`, no-store on errors
4. **SD-1 through SD-6** — Tighten error table, date validation, action return types
5. **AI-1** — Update rate limit key format

## Minor Observations

- AB-001/SPEC-001/SPEC-002: No implementation exists yet — expected for a spec review, not a defect
- The spec doesn't mention `force-dynamic` export for the API route — needed in Next.js to prevent static build
- Migration is additive (nullable column) so rollback is trivial (`ALTER TABLE DROP COLUMN`)
