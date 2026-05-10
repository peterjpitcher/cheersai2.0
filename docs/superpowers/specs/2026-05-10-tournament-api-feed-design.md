# Tournament API Feed — Design Spec

## Goal

Provide a read-only JSON API that brand websites (e.g. the-anchor.pub) can poll to display live tournament fixture data — teams, kick-off times, rounds, booking links, and venue showing status. The feed is authenticated per-tournament via an API key, rate-limited, and cacheable.

## Non-Goals

- Webhook/push notifications (polling is sufficient for fixture data that changes infrequently)
- Write operations (all mutations happen in the CheersAI dashboard)
- Content/media delivery (social media graphics are an internal concern)
- User authentication or session management (API key only)

---

## Architecture

```
Brand Site (the-anchor.pub)
    │
    │  GET /api/feed/[tournamentId]
    │  Header: x-api-key: <key>
    │
    ▼
Next.js API Route (src/app/api/feed/[tournamentId]/route.ts)
    │
    ├─ 1. Rate limit (per-tournament per-IP, 60 req/min) — before any DB query
    ├─ 2. Validate tournament ID format (UUID)
    ├─ 3. Look up tournament + validate API key in one query
    ├─ 4. Query fixtures via service-role client (bypasses RLS)
    ├─ 5. Apply query param filters (showing, round, from, to)
    └─ 6. Return JSON with Cache-Control headers (200 only)
```

### Auth Model

Each tournament has an optional `feed_api_key` column (nullable text). When populated, the feed is enabled. The brand site sends the key via the `x-api-key` header. The route validates the key matches the tournament's stored key before returning data.

No session, no cookies, no JWT — just a simple per-tournament access token.

**Important:** The API key is a **public access token**, not a secret. When used from browser-side JavaScript on a brand site, it is visible in network requests to every visitor. This is acceptable because: (a) the feed data is inherently public — it is displayed on the brand's website, (b) the key exists to identify the consumer and prevent casual scraping, not to protect confidential data, and (c) rate limiting provides the actual abuse prevention.

### Why not use RLS?

The feed is consumed by a server or browser on a third-party domain with no Supabase session. Using the service-role client to query is appropriate here — the API key acts as the access control gate, and the route only exposes a curated subset of fields. Tournament and fixture UUIDs are part of the public API contract and may be used by consumers for keying/deduplication.

---

## Database Changes

### Migration: Add `feed_api_key` to tournaments

```sql
ALTER TABLE tournaments
  ADD COLUMN feed_api_key text;

CREATE UNIQUE INDEX idx_tournaments_feed_api_key
  ON tournaments (feed_api_key)
  WHERE feed_api_key IS NOT NULL;

COMMENT ON COLUMN tournaments.feed_api_key IS
  'API key for the public fixture feed. NULL = feed disabled.';
```

No RLS policy changes needed — the feed route uses the service-role client and the key is validated in application code.

---

## API Endpoint

### `GET /api/feed/[tournamentId]`

**Auth:** `x-api-key` header (must match `tournaments.feed_api_key`).

**Query Parameters (all optional):**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `showing` | `true`/`false` | `true` | Filter by showing status. Default returns only fixtures the venue is screening. |
| `round` | string | — | Filter by round: `group_stage`, `round_of_32`, `round_of_16`, `quarter_final`, `semi_final`, `third_place`, `final` |
| `group` | string | — | Filter by group name (e.g. `Group A`) |
| `from` | ISO 8601 datetime (UTC) | — | Fixtures with kick_off_at >= this value |
| `to` | ISO 8601 datetime (UTC) | — | Fixtures with kick_off_at <= this value. If both `from` and `to` are provided, `from` must be <= `to` or a 400 is returned. |
| `confirmed` | `true`/`false` | — | Filter by teams_confirmed |

**Success Response (200):**

```json
{
  "tournament": {
    "id": "f40ef35f-...",
    "name": "FIFA World Cup 2026",
    "slug": "fifa-world-cup-2026",
    "status": "active"
  },
  "fixtures": [
    {
      "id": "abc123...",
      "matchNumber": 1,
      "round": "group_stage",
      "groupName": "Group A",
      "teamA": "Mexico",
      "teamB": "South Africa",
      "teamsConfirmed": true,
      "kickOffAt": "2026-06-11T19:00:00Z",
      "venueCity": "Mexico City",
      "showing": true,
      "showingNote": "Big screen in the beer garden",
      "bookingUrl": "https://the-anchor.pub/book/world-cup-mexico-vs-south-africa"
    }
  ],
  "meta": {
    "total": 48,
    "generatedAt": "2026-05-10T14:30:00Z"
  }
}
```

**Fields explicitly excluded from the response:**
- `accountId` — internal
- `tournamentId` — redundant (it's in the URL)
- `contentGenerated` — internal content pipeline state
- `createdAt`, `updatedAt` — internal audit fields
- `baseImageSquareId`, `baseImageStoryId` — internal media references
- `houseRulesText`, `postTemplate`, `platforms`, `postLeadHours` — internal config

**Error Responses (evaluated in this order):**

| Step | Status | Body | When |
|------|--------|------|------|
| 1 | 429 | `{ "error": "Rate limit exceeded" }` | More than 60 requests/minute from this tournament+IP. Checked BEFORE any DB query. |
| 2 | 400 | `{ "error": "Invalid tournament ID format" }` | Non-UUID path parameter |
| 3 | 400 | `{ "error": "Invalid query parameters", "details": [...] }` | Bad filter values (invalid round, malformed dates, `from > to`, non-boolean `showing`/`confirmed`) |
| 4 | 401 | `{ "error": "Missing or invalid API key" }` | No `x-api-key` header, or key doesn't match tournament's stored key |
| 5 | 404 | `{ "error": "Tournament not found" }` | UUID is valid but no tournament exists, or feed is disabled (`feed_api_key` is NULL) |
| 6 | 500 | `{ "error": "Internal server error" }` | Database query failure or unexpected error. Never cached. |

All error responses include `Cache-Control: no-store`.

### Caching

Success responses (200) include:
```
Cache-Control: s-maxage=300, stale-while-revalidate=60
Vary: x-api-key
```

`s-maxage` directs CDN caching without affecting browser behaviour. `Vary: x-api-key` ensures the cache partitions by API key. Error responses always include `Cache-Control: no-store`.

The route must export `const dynamic = 'force-dynamic'` to prevent Next.js static optimisation.

Fixture data updates propagate within 5 minutes. After key rotation/disable, cached responses may persist for up to the remaining TTL — this is acceptable for non-sensitive public fixture data.

### CORS

The route sets CORS headers to allow browser-side fetching from any origin:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: x-api-key
Access-Control-Allow-Methods: GET, OPTIONS
```

A preflight OPTIONS handler is also needed to support the custom `x-api-key` header.

### Rate Limiting

Uses the existing `isRateLimited()` utility from `src/lib/auth/rate-limit.ts` with:
- Key: `feed:{tournamentId}:{ip}` — scoped per-tournament per-IP to prevent cross-tournament collision
- Max: 60 requests per minute
- Window: 60,000 ms

Rate limiting is the FIRST check in the route — it runs before any database query to prevent invalid-key flooding.

---

## Server Action: Generate / Regenerate API Key

### `regenerateFeedApiKey(tournamentId: string)`

- Validates auth (must be tournament owner)
- Generates a new 32-character hex key via `crypto.randomBytes(16).toString('hex')`
- Stores in `tournaments.feed_api_key`
- Revalidates the tournament settings page
- Returns `Promise<{ success: true; apiKey: string } | { success: false; error: string }>`

### `disableFeedApiKey(tournamentId: string)`

- Validates auth (must be tournament owner)
- Sets `tournaments.feed_api_key` to NULL
- Revalidates the tournament settings page
- Returns `Promise<{ success?: boolean; error?: string }>`

---

## UI Changes

### Tournament Settings Modal — "API Feed" Section

Add a new section to the existing `TournamentSettingsModal` with:

1. **Feed status indicator** — "Enabled" / "Disabled" badge
2. **API key display** — shown in a monospace read-only input with a copy button. Masked by default with a reveal toggle.
3. **Generate / Regenerate button** — creates a new key. Disabled while pending. If replacing an existing key, shows a confirmation dialog warning that the old key stops working immediately.
4. **Disable button** — sets key to NULL. Disabled while pending. Shows confirmation dialog.
5. **Endpoint URL** — read-only display of the full endpoint URL: `{SITE_URL}/api/feed/{tournamentId}`
6. **Quick-start code snippet** — a `fetch()` example the brand site developer can copy

---

## Security Considerations

1. **API key is a public access token** — stored as plaintext in the DB because the UI needs to display it and it is visible in browser network requests when used client-side. This is acceptable because the feed data is inherently public (displayed on the brand's website). The key is never logged.
2. **Rate limiting** prevents abuse — 60 req/min per tournament per IP, using the existing Supabase-backed rate limit table. Rate limiting runs BEFORE any database query.
3. **Service-role client** is used deliberately — the feed has no user session. The route curates which fields are exposed.
4. **UUID validation** on the tournament ID path param prevents injection via malformed input.
5. **No PII exposure** — the feed contains only public tournament/fixture data. Tournament and fixture UUIDs are intentionally exposed as stable public identifiers.
6. **CORS wildcard** is acceptable because the data is inherently public. The API key provides consumer identification and casual scraping prevention, not confidentiality.
7. **Cache isolation** — `Vary: x-api-key` ensures CDN caches partition responses by key. Error responses are never cached (`no-store`).

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/YYYYMMDD_add_feed_api_key.sql` | Create | Add `feed_api_key` column |
| `src/app/api/feed/[tournamentId]/route.ts` | Create | API route handler |
| `src/app/actions/tournament.ts` | Modify | Add `regenerateFeedApiKey` and `disableFeedApiKey` actions |
| `src/types/tournament.ts` | Modify | Add `feedApiKey` to Tournament type |
| `src/lib/tournament/queries.ts` | Modify | Update `mapTournament` to include `feedApiKey` |
| `src/features/tournament/components/TournamentSettingsModal.tsx` | Modify | Add API Feed section |
| `docs/api-feed.md` | Create | User-facing API documentation |

---

## Testing

1. **API route unit tests:**
   - 401 when no API key
   - 401 when wrong API key
   - 404 when tournament doesn't exist or feed disabled
   - 200 with correct key and fixtures returned
   - Filters: showing, round, group, date range, confirmed
   - 400 on invalid UUID format
   - 429 on rate limit exceeded
   - CORS headers present
   - OPTIONS preflight returns correct headers

2. **Server action tests:**
   - `regenerateFeedApiKey` generates a 32-char hex key
   - `disableFeedApiKey` sets key to NULL
   - Both require auth

3. **Integration smoke test:**
   - Create tournament → generate key → call feed → verify response shape
