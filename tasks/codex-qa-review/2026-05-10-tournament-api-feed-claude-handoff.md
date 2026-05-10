# Claude Hand-Off Brief: Tournament API Feed

**Generated:** 2026-05-10
**Review mode:** C (Spec Compliance)
**Overall risk:** High (3 critical spec defects, all fixable before implementation)

## DO NOT REWRITE
- Read-only feed scope with writes in dashboard ✓
- Curated response field exclusions ✓
- Nullable `feed_api_key` with partial unique index ✓
- `crypto.randomBytes(16)` for key generation ✓
- UUID path param validation ✓
- Per-tournament API key model ✓
- OPTIONS preflight handler requirement ✓

## SPEC REVISION REQUIRED

- [ ] **CR-1 Cache headers**: Replace `Cache-Control: public, max-age=300, stale-while-revalidate=60` with `s-maxage=300, stale-while-revalidate=60`. Add `Vary: x-api-key`. Only set cache headers on 200 responses; errors get `Cache-Control: no-store`.

- [ ] **CR-2 Key classification**: Remove all "shared secret" language. Reclassify `feed_api_key` as a **public access token**. Add note: "The key is visible in browser network requests when used client-side. It exists to identify the consumer and prevent casual scraping, not to protect confidential data."

- [ ] **CR-3 Rate limit ordering**: Update architecture diagram and description. New order: rate limit → UUID validation → tournament lookup → API key check → query fixtures → return data. Rate limit runs BEFORE any DB query.

- [ ] **SD-1 Add 500 error**: Add `500 | { "error": "Internal server error" } | Database query failure or unexpected error` to error table. Errors must not be cached.

- [ ] **SD-2 Error precedence**: Replace ambiguous error table with ordered precedence list matching the new flow.

- [ ] **SD-3 ID exposure**: Remove "no internal IDs" claim from security rationale. Add: "Tournament and fixture UUIDs are part of the public API contract and may be used by consumers for keying/deduplication."

- [ ] **SD-4 Date validation**: Add: "`from` and `to` are parsed as UTC ISO 8601 timestamps. If `from > to`, return 400. Malformed dates return 400."

- [ ] **SD-5 Action return types**: Change `regenerateFeedApiKey` return to `Promise<{ success: true; apiKey: string } | { success: false; error: string }>`. Change `disableFeedApiKey` to standard `Promise<{ success?: boolean; error?: string }>`.

- [ ] **SD-6 Double-submit guard**: Add: "The generate/regenerate button is disabled while the action is pending. If replacing an existing key, show a confirmation dialog warning that the old key will stop working immediately."

- [ ] **AI-1 Rate limit key**: Change from `feed:{ip}` to `feed:{tournamentId}:{ip}` to prevent cross-tournament collision.

- [ ] **Add `force-dynamic`**: Note that the route.ts must export `const dynamic = 'force-dynamic'` to prevent Next.js static optimisation.

## ASSUMPTIONS TO RESOLVE
- [x] API key plaintext storage — **ACCEPTED**: low-sensitivity read-only data, acceptable trade-off
- [x] Fixture UUID exposure — **ACCEPTED**: all dashboard endpoints have proper auth; UUIDs are not secrets
- [x] Cache revocation lag — **ACCEPTED**: max 5 min on non-sensitive data

## REPO CONVENTIONS TO PRESERVE
- Server actions return `{ success?: boolean; error?: string }` with optional data fields
- Use existing `mapFixture` from `src/lib/tournament/queries.ts` — don't duplicate mapping
- Rate limiting uses `isRateLimited()` from `src/lib/auth/rate-limit.ts` with `getRateLimitKey()`
- API routes use `createServiceSupabaseClient()` from `src/lib/supabase/service`
- Error responses follow `NextResponse.json({ error: string }, { status: number })` pattern
- Migrations go in `supabase/migrations/` with timestamp prefix

## RE-REVIEW REQUIRED AFTER FIXES
- [ ] CR-1: Verify cache headers in deployed response after implementation
- [ ] CR-3: Verify rate limit fires before any DB query in route tests
