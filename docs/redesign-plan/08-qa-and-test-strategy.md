# 08 — QA and Test Strategy

> Status: Planning document. No source files are modified by this document.
> Audience: Solo developer / future contributors rebuilding CheersAI 2.0.

---

## 1. Current Test Coverage Audit

### What exists

Seven hand-written test files live under `tests/` and are the only application-owned tests in the repository. All other `.test.ts` files found by a project-wide glob are inside `node_modules/` (Zod, tsconfig-paths, Supabase SSR, svix).

| File | What it covers | Type |
|---|---|---|
| `tests/lib/supabase/errors.test.ts` | `isSchemaMissingError` — Postgres error code classification (42P01, 42703) | Pure unit |
| `tests/linkInBioSchema.test.ts` | Zod schema parsing for link-in-bio profile and tile forms | Pure unit |
| `tests/resolveConnectionMetadata.test.ts` | `resolveConnectionMetadata` inside the Supabase Edge Function (reads from `supabase/functions/`) | Pure unit |
| `tests/connectionMetadata.client.test.ts` | `evaluateConnectionMetadata` in `src/lib/connections/metadata` | Pure unit |
| `tests/plannerActivity.test.ts` | `mapCategoryToLevel` and `resolvePresenter` in the planner activity feed presenter | Unit with module mocks |
| `tests/connectionDiagnostics.test.ts` | `listConnectionDiagnostics` server action — token masking, status normalisation, schema-missing fallback; feature flag for `ENABLE_CONNECTION_DIAGNOSTICS` | Integration-style (mocked Supabase client via `vi.fn()`) |
| `tests/completeConnectionOAuth.test.ts` | `completeConnectionOAuth` server action — happy path: OAuth state lookup, token exchange, connection update, notification insert, path revalidation | Integration-style (mocked Supabase client, mocked `exchangeProviderAuthCode`) |

**Supporting infrastructure:**
- `vitest.config.ts` — `environment: "node"`, `include: ["tests/**/*.test.ts"]`, path alias for `@` and Supabase ESM URLs, `setupFiles: ["./tests/setup.ts"]`.
- `tests/setup.ts` — Stubs `globalThis.Deno` so Edge Function imports work in Node.
- No `@vitest/coverage-v8` or `@vitest/ui` installed; `coverage.reporter` is configured but the provider is not installed. Running `vitest run --coverage` will error.
- No MSW, no Playwright, no Cypress, no jest-dom.

### Critical paths with zero test coverage

The following modules are business-critical and entirely untested:

| Module | File(s) | Risk |
|---|---|---|
| Conflict detection | `src/lib/scheduling/conflicts.ts` | Wrong conflict resolution silently double-books a slot |
| Campaign materialiser | `src/lib/scheduling/materialise.ts` | Cron failure leaves campaigns with no content items for the week |
| Publish queue (Next.js side) | `src/lib/publishing/queue.ts` | `enqueuePublishJob` can throw if variant lookup fails; no test |
| Publish preflight | `src/lib/publishing/preflight.ts` | Token expiry detection, media validation, lint gate — all untested |
| Content rules linter | `src/lib/ai/content-rules.ts` | ~800-line pure function with regex-heavy logic; zero tests |
| Token exchange | `src/lib/connections/token-exchange.ts` | All provider OAuth code paths; runs live fetches with no mock layer |
| Rate limiting | `src/lib/auth/rate-limit.ts` | In-memory fallback logic, Supabase upsert path, window reset — untested |
| Edge Function worker | `supabase/functions/publish-queue/worker.ts` | The entire publish pipeline including retry backoff and provider dispatch |
| Edge Function materialiser | `supabase/functions/materialise-weekly/worker.ts` | Weekly slot generation in Deno runtime |
| Create modal server action | `src/features/create/create-modal-actions.ts` | Orchestration of media, settings, and planner data |
| Provider adapters | `supabase/functions/publish-queue/providers/{facebook,instagram,gbp}.ts` | Media upload, post creation, error handling per provider |

### Test pyramid assessment

The current suite is almost entirely at the base of the pyramid: pure unit tests for utility and schema functions. There are no end-to-end tests and no contract tests. The two "integration-style" tests (OAuth completion, connection diagnostics) mock Supabase at the module level using manually constructed `vi.fn()` call queues. This pattern works but is fragile — the `fromQueue` array in `completeConnectionOAuth.test.ts` must mirror the exact call order of `from()` calls in the implementation, making refactoring expensive.

Coverage thresholds are configured in `vitest.config.ts` but the required `@vitest/coverage-v8` package is not in `devDependencies`. The `test:ci` script will not produce coverage reports.

---

## 2. Testing Pyramid for the Rebuild

### 2.1 Unit Tests (Vitest)

**Scope:** Pure functions with no I/O dependencies. These should run in under 500 ms total and require no network or database access.

**What to unit test:**

**Scheduling calculators** (`src/lib/scheduling/`)
- `resolveConflicts` in `conflicts.ts`: this is a pure function that takes a `ScheduledSlot[]` and returns `ConflictResult[]`. It is high-risk (incorrect conflict resolution causes double-publishing) and perfectly suited to exhaustive property-based testing.
  - Test file: `tests/scheduling/conflicts.test.ts`
  - Cases required:
    - No conflicts: slots on different platforms pass through unchanged.
    - Same-platform slots more than 30 minutes apart: no conflict detected.
    - Same-platform slots within 30 minutes: second slot receives a `+15 min` resolution.
    - Three-way collision on the same platform at the same time: first passes, second gets `+15`, third gets `+30`.
    - Conflict where all resolution offsets are occupied: `resolution` is `undefined` (slot dropped).
    - Slots sorted in descending time order as input: output is still correctly resolved (tests that sort happens before processing).

- `buildSlots` logic in `materialise.ts` (the private `buildSlots` function should be exported or tested indirectly through a testable wrapper):
  - Test file: `tests/scheduling/materialise.test.ts`
  - Cases: cadence entry for Tuesday 10:00 against a window starting on a Wednesday produces a slot in the following week; window boundary conditions.

**Content rules linter** (`src/lib/ai/content-rules.ts`)
- `lintContent` and `applyChannelRules` are large pure functions with well-defined inputs and outputs.
- Test file: `tests/ai/content-rules.test.ts`
- Cases required (minimum set):
  - GBP post with hashtags: `lint_failed` with `gbp_hashtags` issue.
  - Instagram post over 80 words: `word_limit` issue.
  - GBP post over 900 chars: `char_limit` issue.
  - Post containing `{{placeholder}}`: `blocked_tokens` issue; `applyChannelRules` strips it.
  - Story post with non-empty body: `story_caption_present` issue; `applyChannelRules` returns empty string.
  - Facebook post missing CTA URL when context provides one: `cta_url_missing` issue.
  - Instagram post with `linkInBioUrl` in context but missing "link in bio" line: `link_in_bio_missing` issue.
  - Post containing a banned phrase: `banned_phrases` issue.
  - Day name mismatch: post says "Saturday" but `scheduledFor` is a Wednesday — `day_name_mismatch` issue.
  - `resolveContract` called with GBP + `includeHashtags: true`: `maxHashtags` should be 0.
  - `resolveContract` called with Instagram + `includeHashtags: true`: `maxHashtags` should be 6.

**Validation schemas** (Zod)
- Pattern: use `schema.safeParse(input)` and assert `success`, or `schema.parse(input)` and assert throws.
- Existing `tests/linkInBioSchema.test.ts` is a good pattern to copy.
- Add test files for every form schema in `src/lib/create/schema.ts` and campaign-related schemas.

**Rate limit pure logic** (`src/lib/auth/rate-limit.ts`)
- `getRateLimitKey` and `isRateLimitedInMemory` can be tested without Supabase.
- Test file: `tests/auth/rate-limit.test.ts`
- Cases: key construction from IP headers, user-agent fallback, in-memory window reset, count exceeds threshold.

**Connection metadata evaluation** — already covered; extend with GBP `locationId` cases.

**What NOT to unit test:**
- Database query functions — these are glue code; integration tests are more valuable.
- API route handlers — test via integration or E2E.
- React Server Components and client components — these belong to E2E.
- The Edge Function worker — test it at integration level with MSW.

### 2.2 Integration Tests (Vitest + MSW)

**Scope:** Test a module that makes external calls (Supabase, provider APIs, OpenAI) with those calls mocked at the HTTP level using MSW. This is more robust than the current `vi.mock()` pattern because it tests the actual fetch calls rather than mocking import bindings.

**Required package additions:**
```
msw@2  (devDependency)
@vitest/coverage-v8  (devDependency)
```

**MSW setup file:** `tests/msw/server.ts`
```typescript
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
```

`tests/msw/handlers.ts` should export handler groups:
- `facebookHandlers` — mock `graph.facebook.com/oauth/access_token`, `/me/accounts`, `/{page_id}/feed`, `/{page_id}/photos`
- `instagramHandlers` — mock `/{ig_user_id}/media`, `/{ig_user_id}/media_publish`, container status polling
- `gbpHandlers` — mock `oauth2.googleapis.com/token`, `mybusinessbusinessinformation.googleapis.com/v1/...`
- `supabaseHandlers` — mock Supabase REST endpoints for tables (`social_connections`, `publish_jobs`, `content_items`, etc.)
- `openaiHandlers` — mock `api.openai.com/v1/chat/completions`

Update `vitest.config.ts` setup:
```typescript
setupFiles: ["./tests/setup.ts", "./tests/msw/setup.ts"]
```

Where `tests/msw/setup.ts` calls `server.listen()` in `beforeAll`, `server.resetHandlers()` in `afterEach`, and `server.close()` in `afterAll`.

**Publish preflight** (`src/lib/publishing/preflight.ts`)
- Test file: `tests/publishing/preflight.test.ts`
- The function accepts a Supabase client injected as a parameter, so MSW is not needed — mock the client with `vi.fn()` per the existing pattern, or inject a real Supabase client pointed at a test project.
- Cases:
  - Connection missing entirely: returns `[{ code: "connection_missing" }]`.
  - Connection present but `status === "needs_action"`: returns `connection_needs_action`.
  - Token expired (past `expires_at`): returns `connection_token_expired`.
  - Token expires in the future: no token issue.
  - Metadata incomplete (no `pageId` for Facebook): returns `connection_metadata_missing`.
  - GBP + story placement: returns `placement_invalid`.
  - Body empty, placement feed: returns `body_missing`.
  - No media IDs: returns `media_missing`.
  - Story with 2 media IDs: returns `media_story_count`.
  - Story with video asset: returns `media_story_type`.
  - Story with image but no story derivative: returns `media_story_derivative_missing`.
  - All checks pass: returns `[]`.

**Token exchange** (`src/lib/connections/token-exchange.ts`)
- Test file: `tests/connections/token-exchange.test.ts`
- Uses MSW to mock provider HTTP endpoints.
- Cases:
  - Facebook: short-lived token exchange succeeds → long-lived upgrade succeeds → page list returns one page → metadata extracted correctly.
  - Facebook: short-lived token exchange returns HTTP 400 → throws with Graph API error message.
  - Facebook: no pages returned → throws "No Facebook Pages found".
  - Facebook: Instagram provider, page has linked `instagram_business_account` → `igBusinessId` in metadata.
  - GBP: token exchange succeeds → location lookup succeeds → returns `locationId` and display name.
  - GBP: token exchange returns 429 on location lookup → falls back to `existingMetadata.locationId`.
  - GBP: no locations found → throws descriptive error.

**Publish queue enqueue** (`src/lib/publishing/queue.ts`)
- Test file: `tests/publishing/queue.test.ts`
- Mock Supabase client via `vi.fn()`.
- Cases:
  - `variantId` provided: skips variant lookup, inserts job with correct `next_attempt_at`.
  - `variantId` not provided: queries `content_variants`, uses most recent.
  - No variant found: throws `"No variant found for content item"`.
  - `scheduledFor` is `null`: `next_attempt_at` is `now`.

**OAuth completion** (`src/app/(app)/connections/actions.ts`)
- Already partially covered by `tests/completeConnectionOAuth.test.ts`. Extend with:
  - OAuth state not found in database: returns error.
  - `exchangeProviderAuthCode` throws: error is propagated correctly.
  - `isSchemaMissingError` returns true on update: function does not throw.

**Rate limiting with Supabase** (`src/lib/auth/rate-limit.ts`)
- Test file: `tests/auth/rate-limit-integration.test.ts`
- Mock Supabase via MSW or `vi.fn()`.
- Cases:
  - First call within window: upserts count=1, returns `false`.
  - Second call, count becomes 2, max is 3: returns `false`.
  - Fourth call when max is 3: returns `true`.
  - Window expired: resets count to 1, returns `false`.
  - Supabase returns `isSchemaMissingError`: falls back to in-memory.
  - Supabase throws unknown error: falls back to in-memory (logs warning).

**Scheduling materialiser** (`src/lib/scheduling/materialise.ts`)
- Test file: `tests/scheduling/materialise-integration.test.ts`
- Mock Supabase client.
- Cases:
  - Campaign with valid cadence, no existing slots: inserts the correct number of rows for the 7-day window.
  - Campaign with slots already materialised: inserts zero new rows (idempotent).
  - Campaign with partial materialisation: inserts only the missing slots.
  - Campaign with invalid cadence (missing `weekday`): skips the campaign.
  - Supabase client unavailable (`tryCreateServiceSupabaseClient` returns null): returns without throwing.
  - Supabase returns a schema-missing error: returns without throwing.

### 2.3 End-to-End Tests (Playwright)

**Required additions:**
```
@playwright/test  (devDependency)
```

**Config file:** `playwright.config.ts` at project root.

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

**Test directory structure:**
```
e2e/
  auth/
    login.spec.ts
  connections/
    connect-facebook.spec.ts
    connect-gbp.spec.ts
  create/
    instant-post.spec.ts
    schedule-campaign.spec.ts
  planner/
    view-planner.spec.ts
    resolve-failure.spec.ts
  fixtures/
    auth.ts          -- reusable login fixture
    seed.ts          -- seed data helpers
```

**Critical user journeys:**

**1. Login** (`e2e/auth/login.spec.ts`)
- Navigate to `/login`, enter credentials, assert redirect to `/planner`.
- Invalid credentials: assert error message visible.
- Session persists across page reload.

**2. Connect a Facebook account** (`e2e/connections/connect-facebook.spec.ts`)
- Staging environment intercepts OAuth redirect at `/api/oauth/facebook/callback?code=TEST_CODE&state=...`.
- Assert connection appears in `/connections` with status "Active".
- Reconnect flow: existing connection updates access token without creating a duplicate row.

**3. Create an instant post** (`e2e/create/instant-post.spec.ts`)
- Open Create modal, select platform (Facebook), add caption, attach media.
- Click "Post now": assert planner shows item with status "Posted" (or "Queued" if async).
- Preflight failure: publish without media attached — assert error toast with `media_missing` code.

**4. Schedule a weekly campaign** (`e2e/create/schedule-campaign.spec.ts`)
- Create campaign with weekly cadence (Monday 10:00 Facebook + Instagram).
- Assert materialiser runs (trigger cron endpoint or call server action directly).
- Assert planner shows slots for the next occurrence.
- Edit one slot's copy, save, assert variant body updated.

**5. View the planner** (`e2e/planner/view-planner.spec.ts`)
- Navigate to `/planner`, assert scheduled items render.
- Switch between month/week views.
- Click a post: assert detail drawer opens with correct platform and copy.

**6. Resolve a publish failure** (`e2e/planner/resolve-failure.spec.ts`)
- Seed a `notifications` row with `category: "publish_failed"` and metadata.
- Assert activity feed shows error badge with "Publish failed".
- Click "Review post" link: assert navigation to correct content item.

**Staging environment strategy:**
- Maintain a dedicated Supabase project for E2E: `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_ANON_KEY`.
- Use MSW in the Next.js process (via `next-msw` or a test-specific API route) to intercept provider API calls so no real tokens are needed.
- Alternatively, maintain a set of long-lived sandbox tokens for the Facebook Test User App, which allows real OAuth without touching production pages.
- GBP has no sandbox; always mock it.

**Test data management:**
- `e2e/fixtures/seed.ts` — exports `seedAccount()`, `seedConnection()`, `seedContentItem()` functions that call the Supabase service role client directly.
- `afterEach` or `afterAll` hooks call `teardownAccount(accountId)` to delete all rows via cascade.
- Use a dedicated test account UUID that is never used in production.

### 2.4 Contract Tests

**Purpose:** Catch breaking changes in provider API responses before they reach production.

**Implementation:** Snapshot-based tests that record the shape (not the values) of provider API responses.

**Test file:** `tests/contracts/facebook-graph.contract.test.ts`

Record the shape of:
- `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}` response
- `POST /{page_id}/feed` request body and success response `{ id: string }`
- `POST /{page_id}/photos` request body and success response

**Pattern:**
```typescript
it("GET /me/accounts response matches recorded shape", async () => {
  // MSW handler returns a fixture response
  const result = await fetchManagedPages("mock-token");
  expect(result).toMatchSnapshot();
});
```

When Meta changes a field name (e.g. renames `instagram_business_account` to `instagram_account`), the snapshot diff will immediately surface the breakage during CI rather than at 3am.

Maintain contract fixtures in `tests/contracts/fixtures/` as JSON files.

---

## 3. Test Infrastructure

### 3.1 Vitest configuration for Next.js App Router

The current `vitest.config.ts` uses `environment: "node"`, which is correct for server-side code. The configuration requires two additions for the rebuild:

**Coverage provider:**
```typescript
coverage: {
  provider: "v8",
  reporter: ["text", "lcov", "html"],
  include: ["src/lib/**", "src/features/**"],
  exclude: ["src/**/*.stories.*", "src/**/__mocks__/**"],
  thresholds: {
    statements: 70,
    branches: 65,
    functions: 70,
    lines: 70,
  },
},
```

**Server component testing:** Next.js Server Components cannot be rendered in Vitest because they depend on the Next.js request context (`headers()`, `cookies()`). The correct approach is:
- Extract all data-fetching logic into plain async functions (e.g. `listConnectionDiagnostics`) that accept a Supabase client as a parameter. Test those functions in Vitest.
- Test the Server Component markup and UI behaviour in Playwright E2E tests.
- Do not attempt to render Server Components with `@testing-library/react` in a Vitest environment.

**`server-only` imports:** Modules with `import "server-only"` will throw in the test environment. The current `tests/setup.ts` does not stub this. Add to `tests/setup.ts`:
```typescript
vi.mock("server-only", () => ({}));
```
This is already implicitly handled by the fact that Vitest runs in Node, but making it explicit prevents future confusion.

### 3.2 MSW setup

Install: `npm install --save-dev msw`

Generate service worker: `npx msw init public/ --save` (for browser-side use if needed; for Vitest, use `setupServer` from `msw/node`).

Handler organisation in `tests/msw/handlers/`:
```
handlers/
  facebook.ts    -- Graph API handlers
  instagram.ts   -- Graph API + container status polling
  gbp.ts         -- Google OAuth + Business Info API
  openai.ts      -- chat/completions endpoint
  supabase.ts    -- REST API for each table
index.ts         -- re-exports all handlers
```

Each handler file exports a named array: `export const facebookHandlers = [...]`.

Default handlers should return realistic fixture data. Individual tests that need to simulate failures override handlers inline:
```typescript
server.use(
  http.post("https://graph.facebook.com/oauth/access_token", () =>
    HttpResponse.json({ error: { message: "Invalid credentials", code: 190 } }, { status: 400 })
  )
);
```

### 3.3 Test database strategy

**Recommended approach: separate Supabase project with transaction isolation**

- Maintain `SUPABASE_TEST_URL` and `SUPABASE_TEST_SERVICE_ROLE_KEY` environment variables pointing to a dedicated test project.
- For integration tests that use the real Supabase client, wrap each test in a `beforeEach`/`afterEach` that seeds and tears down data.
- For the E2E suite, use `seed.ts` fixtures that create isolated data per test run identified by a unique `run_id`.

**Simpler alternative for the short term:** Continue mocking the Supabase client with `vi.fn()` as in the existing tests. This avoids the need for a second Supabase project. The trade-off is that the mocks must precisely replicate the Supabase query builder chain, which breaks silently when the implementation changes.

**Decision rule:** Use mock Supabase for unit/integration tests of pure server logic. Use a real test Supabase project for E2E and for any test that validates the actual query (e.g. RLS policy correctness).

### 3.4 CI test execution

Add to `.github/workflows/ci.yml` (or equivalent):

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Typecheck
        run: npm run typecheck
      - name: Lint
        run: npm run lint:ci
      - name: Unit + integration tests
        run: npm run test:ci -- --coverage
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
          NEXT_PUBLIC_SITE_URL: http://localhost:3000
          NEXT_PUBLIC_FACEBOOK_APP_ID: test-app-id
          FACEBOOK_APP_SECRET: test-secret
          OPENAI_API_KEY: test-key
          RESEND_API_KEY: test-key
          RESEND_FROM: test@example.com
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage/lcov.info

  e2e:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - name: Run E2E tests
        run: npx playwright test
        env:
          E2E_BASE_URL: http://localhost:3000
          # staging credentials
```

**Parallelism:** Vitest supports `--pool=forks` and `--reporter=verbose`. Playwright's `workers` option should be set to `2` in CI to avoid port conflicts.

---

## 4. Failure Mode Coverage

### Failure 1: Social token expired at publish time

**Context:** `expires_at` is stored when the token is obtained. The worker reads the token at job execution time. If the token expired between scheduling and the cron firing, the provider API returns HTTP 401/190.

**Test scenario (integration):** `tests/publishing/preflight.test.ts`
- Seed `social_connections` row with `expires_at` = 1 hour ago.
- Call `getPublishReadinessIssues` with that connection.
- Assert `issues` contains `{ code: "connection_token_expired" }`.

**Test scenario (worker-level):** `tests/publishing/worker-token-expiry.test.ts`
- Mock the Facebook Graph API to return `{ error: { code: 190, type: "OAuthException" } }` with HTTP 401.
- Assert the worker marks the job as `failed`, records the error, and creates a `publish_failed` notification.
- Assert no retry is scheduled for OAuth errors (non-retriable class).

**Expected system behaviour:** Job transitions to `failed`. Notification created with `category: "publish_failed"` and metadata including the OAuth error. Activity feed displays "Reconnect Facebook" CTA.

### Failure 2: Provider rate limit hit during publish

**Context:** Facebook and Instagram enforce per-hour call rate limits. A burst of posts (e.g. a campaign materialising 10 items at once) may hit these limits.

**Test scenario:** `tests/publishing/worker-rate-limit.test.ts`
- MSW handler for `/{page_id}/feed` returns HTTP 429 with `{ error: { code: 613, type: "OAuthException" } }`.
- Assert worker does NOT mark job as `failed` on first 429 — it schedules a retry with exponential backoff.
- Assert backoff is at least 15 minutes.
- On third 429 (attempt 3), assert job is marked `failed`.

**Expected system behaviour:** First and second failures create `publish_retry` notifications. Third failure creates `publish_failed` notification. Email alert is sent if configured.

### Failure 3: Vercel Cron fires twice (duplicate publish)

**Context:** Vercel's cron has an at-least-once delivery guarantee. Two invocations of the publish worker within the same minute must not result in double-posting.

**Test scenario:** `tests/publishing/worker-idempotency.test.ts`
- Seed one `publish_jobs` row with `status: "queued"`.
- Simulate two concurrent calls to `runPublishWorker()` via `Promise.all`.
- Assert the Facebook Graph API mock receives exactly one `POST /{page_id}/feed` request.
- Assert the job ends with `status: "succeeded"`, not a duplicate row.

**Expected system behaviour:** The worker uses `status = 'queued'` → `'in_progress'` transition with a conditional update (`UPDATE ... WHERE status = 'queued'`). The second invocation finds no eligible rows and exits cleanly. If the database does not implement this atomic transition, this is a critical gap to fix before go-live.

### Failure 4: OpenAI timeout during content generation

**Context:** The AI generation call can time out or return a 503 if OpenAI has an outage.

**Test scenario:** `tests/ai/generation-timeout.test.ts`
- MSW handler for `api.openai.com/v1/chat/completions` delays response for longer than the fetch timeout, or returns HTTP 503.
- Assert the server action returns a user-facing error rather than an unhandled exception.
- Assert no partial `content_variants` row is committed.

**Expected system behaviour:** Generation fails gracefully. The content item remains in `draft` status. The user sees a toast: "Content generation failed — try again". No notification is created (this is a UI-layer failure, not a background failure).

### Failure 5: Invalid media format uploaded

**Context:** Users can upload files that pass browser-side type checks but fail server-side format validation (e.g. a `.jpg` that is actually a HEIC file, or a video codec unsupported by Instagram).

**Test scenario (unit):** `tests/media/validation.test.ts`
- Test the media type detection utility with mismatched MIME types.
- Test that the upload server action rejects files with unsupported extensions.

**Test scenario (integration):** `tests/publishing/preflight-media.test.ts`
- Seed a `media_assets` row with `media_type: "video"` and story placement.
- Call `getPublishReadinessIssues`.
- Assert `issues` contains `{ code: "media_story_type" }`.

**Expected system behaviour:** Upload fails with a clear error message before storage write. If the format error is only discovered at publish time (e.g. Instagram rejects the video codec), the job is marked `failed` with a message pointing the user to re-upload.

### Failure 6: Scheduling conflict not detected

**Context:** Two cadence entries for the same platform at the same time (e.g. Instagram at 10:00 Monday from two different campaigns) should be detected and resolved.

**Test scenario (unit):** `tests/scheduling/conflicts.test.ts` (described in section 2.1)
- Input two `ScheduledSlot` items for `instagram` both at `2026-03-09T10:00:00.000Z`.
- Assert one slot has `resolution` set to a time 15 minutes away.
- Assert `conflictWith` is populated.

**Test scenario (integration):** `tests/scheduling/materialise-integration.test.ts`
- Two campaigns both have a cadence entry for Instagram Monday 10:00.
- Run `materialiseRecurringCampaigns` against mock Supabase.
- Assert the second campaign's slot is inserted at 10:15, not 10:00.

**Expected system behaviour:** Conflict is resolved automatically within ±2 hours. If no resolution is possible, the slot is flagged for user action (currently it is silently dropped — this is a gap in the current implementation that should be addressed).

### Failure 7: Session expires mid-flow

**Context:** The user's Supabase session cookie expires while they are editing a post. The next server action call returns an auth error.

**Test scenario (integration):** `tests/auth/session-expiry.test.ts`
- Mock `requireAuthContext` to throw `new Error("Unauthorized")`.
- Call a server action (e.g. `completeConnectionOAuth`).
- Assert the action returns a structured error or rethrows in a way Next.js can handle.
- Assert no partial state change is committed.

**Test scenario (E2E):** `e2e/auth/session-expiry.spec.ts`
- Expire the session cookie via Playwright's storage state API.
- Attempt to navigate to `/planner`.
- Assert redirect to `/login`.
- Assert the return URL is preserved so the user is sent back after re-authentication.

**Expected system behaviour:** All server actions call `requireAuthContext()` at the start. If the session is invalid, the action throws before performing any writes. Next.js middleware redirects unauthenticated requests at the routing layer.

### Failure 8: Network failure during OAuth callback

**Context:** The OAuth callback at `/api/oauth/{provider}/callback` calls `exchangeProviderAuthCode`, which makes multiple network requests. If any network call fails mid-way (e.g. after the short-lived token is obtained but before the long-lived upgrade), the state is inconsistent.

**Test scenario (integration):** `tests/connections/token-exchange-network-failure.test.ts`
- MSW: short-lived exchange succeeds, long-lived upgrade returns a network error.
- Assert `exchangeFacebookFamilyCode` falls back gracefully (the current code catches long-lived errors with a `console.warn` and continues with the short-lived token).
- Assert the returned token is still valid (short-lived) and the exchange completes.

**Test scenario:** Long-lived exchange succeeds, but `fetchManagedPages` returns a network error.
- Assert function throws with a message that identifies the failure point.
- Assert no `social_connections` row is written (the server action upstream must not write partial state).

**Expected system behaviour:** The OAuth callback returns the user to the connections page with an error query parameter. The `oauth_states` row is cleaned up regardless of success or failure.

### Failure 9: GBP post fails content policy validation

**Context:** Google Business Profile rejects posts that violate its content policies (e.g. promotional claims that do not meet their standards). The API returns a 400 with a specific error code.

**Test scenario (integration):** `tests/publishing/worker-gbp-policy.test.ts`
- MSW handler for the GBP posts endpoint returns `{ error: { code: 400, message: "Request contains an invalid argument", status: "INVALID_ARGUMENT" } }`.
- Assert the worker recognises this as a non-retriable failure (content policy violations will not resolve on retry).
- Assert the job is marked `failed` immediately without scheduling a retry.
- Assert the notification message includes guidance: "Review post content for Google Business Profile policy compliance."

**Expected system behaviour:** The GBP adapter must distinguish between retriable errors (5xx, 429) and non-retriable errors (4xx policy violations). The linter (`lintContent`) should catch many policy violations before the job is ever created, but the worker must handle the case where the API rejects content that passed local linting.

### Failure 10: Recurring campaign materialiser crashes

**Context:** The `materialiseRecurringCampaigns` function is called by Vercel Cron (or a Supabase Edge Function). If it throws an unhandled exception, the week's slots are not created, and the weekly posts are silently skipped.

**Test scenario (integration):** `tests/scheduling/materialise-crash.test.ts`
- Mock `supabase.from("campaigns")` to throw `new Error("Connection timeout")`.
- Wrap `materialiseRecurringCampaigns` call.
- Assert it does NOT throw (the function should catch Supabase errors, log them, and return without crashing the Cron handler).
- The current implementation re-throws non-schema-missing errors — this is the gap. The Cron handler itself must catch and alert.

**Test scenario:** Mock the `content_items` insert to throw on the second campaign.
- Assert the first campaign's slots are committed and the error from the second is logged.
- The current implementation uses a `for` loop with sequential `await` calls — a throw on campaign 2 will leave campaign 3 unprocessed. This must be fixed with a per-campaign try/catch.

**Expected system behaviour:** The materialiser processes each campaign independently. A failure for one campaign logs an error and sends an alert notification but does not prevent other campaigns from materialising. The Cron endpoint returns HTTP 200 regardless of per-campaign failures, so Vercel does not mark the Cron as failed (which would suppress future invocations).

---

## 5. CI/CD Gates

### Required checks before any merge to `main`

All checks run in parallel where possible. A single failure blocks the merge.

| Gate | Command | Must pass |
|---|---|---|
| TypeScript | `npm run typecheck` | Zero type errors |
| ESLint | `npm run lint:ci` | Zero warnings (`--max-warnings=0`) |
| Unit + integration tests | `npm run test:ci -- --coverage` | All tests pass |
| Coverage thresholds | Enforced by Vitest `thresholds` config | See below |
| Build | `npm run build` | Zero build errors |
| E2E smoke tests | `npx playwright test --grep @smoke` | Tagged smoke tests pass |

The `ci:verify` script in `package.json` already chains lint, typecheck, test, and build. Extend it to include E2E smoke: `npm run lint:ci && npm run typecheck && npm run test:ci && npm run build && npx playwright test --grep @smoke`.

### Coverage thresholds per module

| Module path | Statement % | Branch % | Notes |
|---|---|---|---|
| `src/lib/scheduling/` | 90 | 85 | Highest-risk pure logic |
| `src/lib/ai/content-rules.ts` | 85 | 80 | Large pure function |
| `src/lib/publishing/preflight.ts` | 85 | 80 | Every issue code path |
| `src/lib/auth/rate-limit.ts` | 80 | 75 | In-memory fallback branch |
| `src/lib/connections/` | 75 | 70 | Token exchange covered by integration |
| `src/features/` | 60 | 55 | UI-heavy; E2E supplements |
| Global minimum | 70 | 65 | Enforced by Vitest config |

These thresholds are not targets for the initial rebuild sprint — they are targets to be met before the `v1.0` production go-live. During active development, set lower thresholds and raise them incrementally.

### Pre-deploy smoke tests

Run these against the staging deployment after each successful CI build, before promoting to production:

1. `GET /` redirects to `/login` for unauthenticated requests (confirms middleware works).
2. `POST /api/cron/materialise-weekly` with correct `CRON_SECRET` header returns HTTP 200.
3. `POST /api/cron/publish-queue` with correct `CRON_SECRET` header returns HTTP 200 (or 204 if queue is empty).
4. `GET /planner` for authenticated user returns HTTP 200 with expected page title.
5. Connections page loads without JavaScript errors.

These smoke tests can be implemented as Playwright tests tagged with `@smoke` or as simple `curl` assertions in a shell script.

### Feature flag strategy

Use environment variables as feature flags. The existing `featureFlags` object in `src/env.ts` (demonstrated by `ENABLE_CONNECTION_DIAGNOSTICS`) is the correct pattern to extend.

**Convention:**
```typescript
export const featureFlags = {
  connectionDiagnostics: Boolean(process.env.ENABLE_CONNECTION_DIAGNOSTICS),
  weeklyMaterialiser: Boolean(process.env.ENABLE_WEEKLY_MATERIALISER),
  gbpPublishing: Boolean(process.env.ENABLE_GBP_PUBLISHING),
  storyPlacements: Boolean(process.env.ENABLE_STORY_PLACEMENTS),
};
```

Each flag is set in Vercel's environment variable dashboard per deployment environment. This allows new features to be deployed to staging with the flag on, and production with the flag off, before a coordinated cutover.

Feature flags must themselves be tested: add a test for each flag that asserts both the truthy and falsy code paths, following the pattern in `tests/connectionDiagnostics.test.ts`.

---

## 6. Release and Rollback Strategy

### Feature flag implementation recommendation

For a single-owner application, environment variable feature flags (described above) are sufficient. Do not introduce a third-party feature flag SaaS. The operational overhead outweighs the benefit at this scale.

The rollout process for any significant feature:

1. Deploy to staging with flag `ENABLE_<FEATURE>=true`.
2. Run full E2E suite against staging.
3. Manually verify the feature in staging.
4. Deploy to production with flag `ENABLE_<FEATURE>=false` (feature dormant in production).
5. Flip flag in Vercel dashboard (triggers a rebuild or a config-only redeploy depending on Vercel plan).
6. Monitor for 24 hours.
7. If stable: flag stays on permanently; remove the flag guard in the next sprint.

### Staged rollout

This is a single-owner application, so percentage-based traffic splitting is not applicable. The staged rollout model is:

| Stage | What happens |
|---|---|
| Dev | Feature developed and unit tested locally |
| Staging | Full E2E suite runs; manual smoke test |
| Production (flag off) | Code deployed but feature inactive |
| Production (flag on) | Feature active; monitor activity feed and Vercel logs for 24h |
| Stable | Flag removed from code; feature permanent |

### Monitoring during go-live

For each production flag flip, monitor:
- Vercel Functions error rate (Runtime Errors tab in Vercel dashboard).
- Supabase realtime dashboard: `publish_jobs` with `status = 'failed'` count.
- In-app activity feed: any new `publish_failed` or `connection_*` notifications.
- Scheduled posts at the first cron firing after the flag change: confirm they fire and succeed.

Set a manual reminder 15 minutes after the cron's scheduled time to check the activity feed. A publish failure at 3am is the primary risk scenario; ensure notifications are configured to send email via Resend so failures surface even without active monitoring.

### Rollback triggers

Initiate rollback immediately if any of the following occur:

- A `publish_failed` notification appears within 1 hour of a deployment.
- The materialiser cron produces no new `content_items` rows when campaigns exist with active cadences.
- The Vercel Functions error rate exceeds 1% over a 5-minute window.
- Any `500` response from a server action that was previously returning `200`.
- An OAuth callback returns the user to the connections page with an error.

### Rollback procedure

1. **Immediate (< 2 minutes):** Flip the feature flag off in Vercel dashboard. This triggers an instant redeploy with the flag disabled. No code changes needed.

2. **If the flag does not isolate the issue:** Revert to the previous deployment via the Vercel dashboard "Promote to Production" button on the prior build. This takes under 30 seconds.

3. **If database state is corrupted:** Use Supabase point-in-time recovery (if enabled) or restore from the most recent daily backup. The `publish_jobs` table is the most likely to need correction: mark any `in_progress` jobs that were abandoned as `queued` so they are retried after rollback.

4. After rollback, review Vercel Function logs and Supabase logs to identify the root cause before re-deploying.

### Go-live checklist

This checklist must be completed before removing the `ENABLE_*` flag guard from any major feature.

**Infrastructure:**
- [ ] Supabase migrations applied to production (verify with `supabase db diff`).
- [ ] Environment variables set in Vercel production environment.
- [ ] Cron schedules configured in `vercel.json` and active.
- [ ] Resend email alerts tested end-to-end from staging.
- [ ] `CRON_SECRET` and `ALERTS_SECRET` rotated from staging values.

**Testing:**
- [ ] All unit and integration tests pass on `main`.
- [ ] E2E suite passes against staging deployment.
- [ ] Manual smoke test of each critical journey (login, connect, post, schedule, planner view).
- [ ] Preflight checks verified for all three platforms (Facebook, Instagram, GBP).

**Observability:**
- [ ] Vercel log drain configured (Logflare or Axiom recommended).
- [ ] Activity feed displays correctly for `publish_failed`, `publish_retry`, and `connection_reconnected` categories.
- [ ] Email notification delivers within 2 minutes of a seeded `publish_failed` event.

**Scheduling:**
- [ ] Weekly materialiser has run at least once on staging and produced correct slots.
- [ ] Conflict resolution verified manually: two overlapping cadence entries produce distinct slot times.
- [ ] Token health check cron runs without error and produces `expiring` status for a test connection with a near-future `expires_at`.

**Documentation:**
- [ ] Runbook (`docs/runbook.md`) updated with any new failure modes or recovery procedures.
- [ ] Connection setup guide includes current OAuth app credentials and permission scopes.

---

## Appendix A: Recommended `devDependencies` to add

```json
{
  "@playwright/test": "^1.44.0",
  "@vitest/coverage-v8": "^4.0.16",
  "@vitest/ui": "^4.0.16",
  "msw": "^2.3.0"
}
```

Add npm scripts:
```json
{
  "test:ui": "vitest --ui",
  "test:coverage": "vitest run --coverage",
  "e2e": "playwright test",
  "e2e:ui": "playwright test --ui",
  "e2e:smoke": "playwright test --grep @smoke"
}
```

## Appendix B: Test file creation priority

Ordered by risk and implementation effort. Implement in this order during the rebuild sprint.

| Priority | File | Reason |
|---|---|---|
| 1 | `tests/scheduling/conflicts.test.ts` | Pure function, high risk, zero current coverage |
| 2 | `tests/ai/content-rules.test.ts` | Large pure function, zero coverage, used in preflight |
| 3 | `tests/publishing/preflight.test.ts` | Gates every publish; all paths need coverage |
| 4 | `tests/scheduling/materialise-integration.test.ts` | Cron reliability; idempotency critical |
| 5 | `tests/connections/token-exchange.test.ts` | OAuth correctness; MSW setup required first |
| 6 | `tests/publishing/worker-idempotency.test.ts` | Duplicate publish prevention |
| 7 | `tests/publishing/queue.test.ts` | Enqueue logic; variant fallback |
| 8 | `tests/auth/rate-limit.test.ts` | Auth protection; in-memory fallback |
| 9 | `e2e/create/instant-post.spec.ts` | Core user journey; smoke candidate |
| 10 | `e2e/planner/resolve-failure.spec.ts` | Operational visibility; 3am scenario |
