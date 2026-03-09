# 04 — Auth and Security Design

> Redesign-plan section. Covers the current security audit, then specifies the target design for the rebuild.
> Audience: lead engineer and any reviewer. Date reviewed against codebase: 2026-03-05.

---

## 1. Current Auth Audit

### 1.1 What Works Well

- **`requireAuthContext` is used consistently in every server action.** All five `actions.ts` files (`connections`, `library`, `settings`, `create`, `planner`) call `requireAuthContext()` before any DB write. This is the single most important control and it is correctly applied. (`src/lib/auth/server.ts:12`)

- **`getUser()` is called, not `getSession()`.** `requireAuthContext` uses `supabase.auth.getUser()` which makes a network round-trip to Supabase to validate the JWT, rather than trusting the locally-decoded cookie. This is the correct pattern. (`src/lib/auth/server.ts:17`)

- **Rate limiting exists on both auth endpoints.** Login is limited to 8 attempts per 60 s; magic-link is limited to 5 per 60 s. Both fall back to in-memory if Supabase is unavailable. (`src/app/api/auth/login/route.ts:6-16`, `src/app/api/auth/magic-link/route.ts:6-15`)

- **CRON_SECRET is verified on both cron endpoints.** Both `/api/cron/publish` and `/api/cron/purge-trash` check for the secret before executing. The secret is validated to be non-empty at startup in production. (`src/app/api/cron/publish/route.ts:67-79`, `src/app/api/cron/purge-trash/route.ts:14-30`)

- **OAuth state is a random UUID stored server-side.** `startConnectionOAuth` generates a UUID state token, writes it to an `oauth_states` table via the service client, and `completeConnectionOAuth` looks it up by value before exchanging any code. This is a solid server-side state pattern. (`src/app/(app)/connections/actions.ts:135-159`)

- **`redirectTo` in `completeConnectionOAuth` is path-validated.** `resolveRedirectPath` rejects any value that does not start with `/` or starts with `//`, preventing open redirect. (`src/app/(app)/connections/actions.ts:317-326`)

- **Service role key is not in the client bundle.** `env.server.SUPABASE_SERVICE_ROLE_KEY` is only accessed in files that import `src/lib/supabase/service.ts`, none of which are client components. `src/lib/supabase/client.ts` uses only the anon key.

- **Stale OAuth state pruning.** `cleanupStaleOAuthStates` removes unused states older than 30 min and used states older than 24 h, limiting replay window. (`src/app/(app)/connections/actions.ts:279-315`)

- **Error message normalisation in auth response.** The login route returns a generic `"Unable to sign in."` regardless of the specific Supabase error, preventing user-enumeration. (`src/app/api/auth/login/route.ts:37`)

- **`server-only` import on rate-limit module.** `src/lib/auth/rate-limit.ts:1` imports `"server-only"`, ensuring the module cannot be accidentally bundled client-side.

---

### 1.2 Security Issues by Severity

#### CRITICAL

**C-1: Middleware does not enforce authentication on any route.**
`middleware.ts` only performs an apex-to-www redirect. There is no session check, no protection of `(app)` routes, and no redirect to `/login` for unauthenticated requests. A user who manually navigates to any app URL without a session will reach the server component, which will then hit `requireAuthContext()` and redirect — but this is a per-component defence with no central enforcement. If any server component or route ever fails to call `requireAuthContext`, it is silently open.

File: `middleware.ts:1-26`

**C-2: OAuth callback route does not verify session ownership.**
`/api/oauth/[provider]/callback/route.ts` accepts an inbound `?state=` parameter and writes `auth_code` to `oauth_states` using only `state` as the lookup key. It does not verify that the request came from an authenticated session. Any unauthenticated actor who knows a valid state UUID can poison the `auth_code` field with a different code before the owner's browser calls `completeConnectionOAuth`. The flow then exchanges the attacker's code instead.

File: `src/app/api/oauth/[provider]/callback/route.ts:27-49`

The `completeConnectionOAuth` server action does check auth before exchange, so this is partially mitigated — but the callback route itself has no auth check and can be used to overwrite `auth_code` and `error` for any known state UUID.

#### HIGH

**H-1: CRON_SECRET comparison is not timing-safe.**
Both cron routes use `headerSecret !== cronSecret` (a plain string equality check). This is vulnerable to a timing side-channel. In a CPU-time-observable environment an attacker can brute-force the secret byte by byte. The Node.js `crypto.timingSafeEqual` API must be used instead.

Files: `src/app/api/cron/publish/route.ts:77`, `src/app/api/cron/purge-trash/route.ts:24`

**H-2: CRON_SECRET is accepted in a URL query parameter.**
`?secret=<value>` is an accepted fallback in both cron routes. URL query parameters appear in web-server access logs, reverse-proxy logs, and browser history. Any log aggregation pipeline will leak the secret in plaintext.

Files: `src/app/api/cron/publish/route.ts:75,77`, `src/app/api/cron/purge-trash/route.ts:23-24`

**H-3: Social OAuth tokens are stored in plaintext.**
`social_connections.access_token` and `social_connections.refresh_token` are written as bare strings. There is no application-layer encryption. Anyone with access to the Supabase dashboard, a database backup, or who compromises the service role key can read all platform credentials for all connections. For a publishing application these tokens can post content on behalf of the owner.

File: `src/app/(app)/connections/actions.ts:230-237` — tokens written directly into the update payload.

**H-4: No Content Security Policy (CSP) headers.**
`next.config.ts` only sets `X-Robots-Tag`. There are no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Strict-Transport-Security` headers configured. This exposes the application to XSS, clickjacking, and MIME-sniffing attacks.

File: `next.config.ts:7-21`

**H-5: `/api/planner/activity` route has no explicit auth guard.**
The route calls `getPlannerActivity()` and catches a `NEXT_REDIRECT` error to infer unauthorised access. This is fragile: it relies on the data-layer function internally calling `requireAuthContext`. If `getPlannerActivity` ever returns successfully without auth (e.g. after a refactor that removes the internal call), the route silently serves data.

File: `src/app/api/planner/activity/route.ts:13-38`

**H-6: Magic link `emailRedirectTo` is not validated against an allowlist.**
The magic-link endpoint accepts a `redirectTo` field from the request body and passes it directly to Supabase's `emailRedirectTo` option without checking that it resolves to the application's own origin. An attacker can craft a magic-link request that redirects the owner to an attacker-controlled URL post-authentication.

File: `src/app/api/auth/magic-link/route.ts:28-40`

#### MEDIUM

**M-1: Rate-limit in-memory store is per-process and resets on deployment.**
The `fallbackStore` `Map` in `rate-limit.ts` is per-serverless-invocation. On Vercel, multiple concurrent instances each maintain their own counter. A high-rate attack spread across IP addresses will evade per-instance counting entirely. The Supabase-backed path shares state, but falls back to per-instance on any error.

File: `src/lib/auth/rate-limit.ts:7,48-58`

**M-2: IP extraction trusts all forwarded headers without origin validation.**
`extractIp` iterates `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip` etc. without checking whether the incoming request is actually from a trusted proxy. On Vercel the `x-forwarded-for` header is set by the platform, but in a self-hosted or Docker deployment an attacker can spoof any header to rotate their effective rate-limit key.

File: `src/lib/auth/rate-limit.ts:13-31`

**M-3: Owner email and UUID are hardcoded in `constants.ts`.**
`OWNER_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001"` and `OWNER_EMAIL = "peter@orangejelly.co.uk"` are checked into source. The email is PII. The predictable UUID means anyone who can query the DB knows the exact account_id without any enumeration effort.

File: `src/lib/constants.ts:1-4`

**M-4: Google location data cached in a module-level `Map` with no invalidation on token revocation.**
`googleLocationCache` in `token-exchange.ts` caches location data keyed by `locationId` for 5 minutes. If the GBP connection is revoked and reconnected for a different location within the TTL window, the stale location could be returned. This is a data-correctness issue rather than a direct security flaw, but it can lead to content being attributed to the wrong business.

File: `src/lib/connections/token-exchange.ts:14`

**M-5: `signOut` server action does not invalidate the session server-side before redirecting.**
`signOut` in `actions.ts` calls `supabase.auth.signOut()` (which sends a logout request to Supabase), but does not explicitly clear the session cookies before the redirect. If the Supabase call fails silently, the cookie remains valid. `clearSupabaseSessionCookies` exists in `server.ts` but is not called from `signOut`.

File: `src/lib/auth/actions.ts:7-11`

**M-6: `service.ts` creates a new `SupabaseClient` on every call with no connection pooling.**
`createServiceSupabaseClient` instantiates a fresh client on every invocation. While this is safe, it bypasses the persistent session management layer entirely. There is no guard preventing this function from being called in a client component context other than TypeScript module resolution.

File: `src/lib/supabase/service.ts:16-26`

**M-7: No webhook signature verification.**
`INSTAGRAM_VERIFY_TOKEN` and `INSTAGRAM_APP_SECRET` are defined in `env.ts` and `.env.example`, implying webhook routes are planned or exist elsewhere. There are currently no webhook API routes in the codebase. When they are added, inbound webhook payload integrity must be verified with HMAC-SHA256 before any processing.

File: `src/env.ts:60-61`

#### LOW

**L-1: `env.ts` uses `readOptionalEnv` (silent empty string) for most secrets.**
Critical secrets like `FACEBOOK_APP_SECRET`, `GOOGLE_MY_BUSINESS_CLIENT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` default to `""` at module load time. The production validation (`validateProductionEnv`) only runs when `NODE_ENV === "production"`, meaning staging and development builds can boot silently with missing secrets and fail at runtime with opaque errors.

File: `src/env.ts:53-68, 90-116`

**L-2: Auth error detail logged to console at `[auth] signInWithPassword failed`.**
The login route logs `{ email, message: error.message, status: error.status }` to the console. In a hosted environment this appears in the platform log stream. The email address is PII; including it in logs may violate GDPR logging minimisation requirements.

File: `src/app/api/auth/login/route.ts:37`

**L-3: `resolveAccountId` reads `user_metadata` but then discards it in favour of `app_metadata`.**
The function reads `app_metadata.account_id` first (correct — only the service role can write `app_metadata`), but the fallback is `user.id` directly. This is safe for a single-owner app but would silently allow any authenticated user to become "the owner" in a future multi-tenant fork. A comment explaining this trust boundary would prevent future regressions.

File: `src/lib/auth/server.ts:71-80`

**L-4: The `createBrowserSupabaseClient` is importable from any client component with no guard.**
`src/lib/supabase/client.ts` has no `"use client"` directive or `client-only` import. Any server component could accidentally import it. The inverse of the `server-only` guard should be applied here.

File: `src/lib/supabase/client.ts:1`

---

## 2. Authentication Design for Rebuild

### 2.1 Session Management — Supabase SSR Cookie Pattern

Use `@supabase/ssr` throughout. The server client reads and writes httpOnly, Secure, SameSite=Lax cookies via the Next.js `cookies()` API. The browser client (used only for auth state change events and real-time subscriptions) uses the same cookie store. Never store the access token in `localStorage`.

Cookie attributes to enforce:
- `HttpOnly: true` — prevents JavaScript from reading the token.
- `Secure: true` — TLS-only in production (Supabase SSR sets this automatically when the deployment URL is HTTPS).
- `SameSite: Lax` — blocks cross-site POST CSRF while allowing top-level GET navigations (e.g. OAuth redirects).
- `Path: /` — full-application scope.
- `Max-Age`: defer to Supabase's default (1 hour access token, 7-day refresh token with rolling refresh).

### 2.2 Middleware Specification

The middleware must perform session validation, not just URL rewriting. Replace the current apex-redirect-only middleware with one that:

1. Reads and validates the session for every request matching the `(app)` group.
2. Refreshes the access token (via `supabase.auth.getUser()`) if the JWT is expired but the refresh token is still valid.
3. Writes updated cookies back to the response before passing to the route.
4. Redirects unauthenticated requests to `/login?next=<encoded-path>`.

```typescript
// middleware.ts (target)
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PREFIX = ["/planner", "/create", "/library", "/connections", "/settings"];
const AUTH_ROUTES = ["/login", "/auth"];

export async function middleware(request: NextRequest) {
  // 1. Apex redirect (retain existing behaviour)
  const host = request.headers.get("host") ?? "";
  if (host.toLowerCase() === "cheersai.uk") {
    const url = request.nextUrl.clone();
    url.host = "www.cheersai.uk";
    return NextResponse.redirect(url, 308);
  }

  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIX.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // 2. Build a response object so we can write refreshed cookies.
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // 3. Validate session (performs network round-trip; refreshes if needed).
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|api/oauth).*)"],
};
```

Routes explicitly excluded from the middleware matcher:
- `/api/auth/*` — login and magic-link endpoints are public by definition.
- `/api/oauth/*/callback` — the OAuth provider redirects here before the owner's session exists in the callback window; auth is enforced inside `completeConnectionOAuth`.
- `/api/cron/*` — secured via `CRON_SECRET`, not session.
- `/login`, `/auth/callback` — public.

### 2.3 Auth Method Recommendation

**Recommendation: magic link as primary, password as secondary, passkey as stretch goal.**

Rationale:
- This is a single-owner app with one known email address. The threat model for authentication is an external attacker, not a confused user.
- Magic links eliminate password storage, password-reset flows, and credential-stuffing risk at the cost of one email delivery per session.
- Passwords remain useful when email delivery is slow or unreliable (e.g. Resend outage). Enable password auth in Supabase but do not advertise it in the UI.
- Passkeys (WebAuthn) provide the strongest local authentication guarantee and no server-side secret. Supabase supports passkeys natively since Auth v2.68. Add as a future upgrade once the magic-link baseline is stable.

### 2.4 Session Timeout and Refresh Strategy

| Parameter | Value | Rationale |
|---|---|---|
| JWT access token TTL | 1 hour (Supabase default) | Short enough to limit replay window |
| Refresh token TTL | 7 days rolling | Allows normal browser use without constant magic-link requests |
| Refresh token reuse detection | Enabled (Supabase setting) | Supabase will revoke the family if a used refresh token is replayed |
| Middleware refresh | On every protected page request | Handled by `supabase.auth.getUser()` in middleware |
| Inactivity timeout | None (app is single-user, always-authenticated model) | Adding an inactivity logout would require client-side JS and is not worth the UX cost |

If the refresh token is expired or revoked, `getUser()` returns `null` and middleware redirects to `/login`. The `requireAuthContext` server-side guard provides a second check and calls `clearSupabaseSessionCookies` before redirecting.

---

## 3. Social OAuth Security Design

### 3.1 State Parameter Generation and Validation

The current `randomUUID()` state token stored in `oauth_states` is sound. The rebuild retains this pattern with the following hardening:

1. **Bind state to session.** When generating the state, store the authenticated user's Supabase `user.id` alongside it in `oauth_states`. The callback route (which currently has no auth check) must look up the state and verify that the `user_id` column matches the session user before writing `auth_code`. This closes C-2.

2. **State expiry enforced at DB level.** Add a `NOT NULL expires_at` column (`created_at + 10 minutes`) to `oauth_states` and filter by `expires_at > now()` in all lookup queries. The current cleanup is best-effort; a DB-level expiry check is a hard gate.

3. **Mark state as consumed atomically.** The callback sets `used_at` and `auth_code` in a single `UPDATE ... WHERE state = $1 AND used_at IS NULL AND expires_at > now()` query. A second call with the same state will update 0 rows, which the route must treat as an error and redirect to an error page.

4. **PKCE is not required** because the code exchange happens entirely server-side (the browser never sees the auth code after the callback). PKCE adds value when the exchange happens in a public client (SPA, mobile app). The server-side pattern is the secure equivalent.

### 3.2 Token Storage — Encryption Design

**Current gap (H-3):** tokens stored in plaintext.

**Target design:** AES-256-GCM application-layer encryption before any token is written to `social_connections`.

#### Key Management

Derive a symmetric encryption key from a dedicated environment variable `TOKEN_ENCRYPTION_SECRET` (a 32-byte random value, base64-encoded). Do not use PBKDF2 for this — the secret is already a high-entropy random value.

```
KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_SECRET, "base64")
// Must be exactly 32 bytes (256 bits) for AES-256.
```

Keep `TOKEN_ENCRYPTION_SECRET` in the Vercel environment (or equivalent secrets manager). It is never transmitted to the browser, never logged, and never accessed from client components.

#### Encryption Function

```typescript
// src/lib/crypto/tokens.ts
import "server-only";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;   // GCM recommended IV length
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_SECRET;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_SECRET is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_SECRET must decode to exactly 32 bytes");
  return key;
}

/**
 * Returns a base64url string in the format: <iv>.<ciphertext>.<authTag>
 * Each segment is base64url-encoded.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(".");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivB64, dataB64, tagB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
```

#### Where Encryption/Decryption Happens

| Operation | Location | Action |
|---|---|---|
| Token write after OAuth exchange | `completeConnectionOAuth` server action | Call `encryptToken(exchange.accessToken)` and `encryptToken(exchange.refreshToken)` before building `updatePayload` |
| Token write after refresh | Publishing worker / token-refresh service | Same — always encrypt before writing |
| Token read for publishing | `src/lib/publishing/queue.ts` or provider adapter | Call `decryptToken(row.access_token)` immediately before use; do not store plaintext in any variable that outlives the immediate HTTP call |
| Token read for diagnostics | `src/lib/connections/diagnostics.ts` | Same; redact from logs (`token.slice(0, 8) + "..."`) |

**Database schema change:** rename columns to `access_token_enc` and `refresh_token_enc` to make the encrypted nature explicit. This prevents any future code from accidentally treating them as plaintext.

#### Key Rotation

When rotating `TOKEN_ENCRYPTION_SECRET`:

1. Provision the new key as `TOKEN_ENCRYPTION_SECRET_NEXT`.
2. Deploy a one-time migration script that decrypts each token with the current key and re-encrypts with the next key.
3. Swap `TOKEN_ENCRYPTION_SECRET` to the new value and remove `TOKEN_ENCRYPTION_SECRET_NEXT`.
4. No downtime required — the migration can run against a low-traffic window.

### 3.3 Token Refresh Flow

For Google (the only provider with a refresh token):

```
publishing worker
  → fetch social_connections row (encrypted tokens)
  → decryptToken(access_token_enc) → attempt API call
  → on 401/403:
      → decryptToken(refresh_token_enc)
      → POST https://oauth2.googleapis.com/token (grant_type=refresh_token)
      → on success: encryptToken(new access_token) → update DB
      → on failure (refresh revoked): set status='needs_action', emit notification
  → on success: proceed with publish
```

For Facebook / Instagram (long-lived tokens, 60-day validity, no refresh token):

```
nightly token health job
  → for each active connection where expires_at < now() + 5 days:
      → decryptToken(access_token_enc)
      → POST graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token
      → on success: encryptToken(new_token), update expires_at
      → on failure: status='needs_action', emit notification with reconnect link
```

### 3.4 Revocation Handling

When the owner clicks "Disconnect" in the UI:

1. Server action decrypts the access token.
2. Calls the provider's revocation endpoint:
   - Facebook: `DELETE graph.facebook.com/{user-id}/permissions`
   - Google: `POST https://oauth2.googleapis.com/revoke?token=<access_token>`
3. Regardless of the revocation API response, sets `status='disconnected'`, clears `access_token_enc`, `refresh_token_enc`, `expires_at` in the DB.
4. Any queued `publish_jobs` for that provider are cancelled and a notification emitted.

---

## 4. API and Webhook Security

### 4.1 Cron Endpoint Security

Fix H-1 (timing-safe) and H-2 (URL parameter) in the rebuild.

**Pattern (code example):**

```typescript
// src/lib/cron/verify-secret.ts
import "server-only";
import { timingSafeEqual } from "node:crypto";

export function verifyCronSecret(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  // Accept only the Authorization header or x-cron-secret.
  // NEVER accept via URL query parameter.
  const authHeader = request.headers.get("authorization") ?? "";
  const xCronSecret = request.headers.get("x-cron-secret") ?? "";
  const candidate = xCronSecret || authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!candidate) return false;

  // Timing-safe comparison. Both buffers must be the same length.
  const secretBuf = Buffer.from(cronSecret, "utf8");
  const candidateBuf = Buffer.from(candidate, "utf8");
  if (secretBuf.length !== candidateBuf.length) return false;

  return timingSafeEqual(secretBuf, candidateBuf);
}
```

Apply this helper at the top of every cron handler before any business logic:

```typescript
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... rest of handler
}
```

Vercel Cron configuration passes the secret in the `Authorization: Bearer <secret>` header automatically. Do not configure the `?secret=` query string fallback in `vercel.json`.

### 4.2 Server Action Auth Guard Pattern

Every server action file must import and call `requireAuthContext()` as the first statement before any user input is read or any DB operation is performed. The function throws/redirects on failure; there is no return value to check.

**Pattern (code example):**

```typescript
"use server";

import { requireAuthContext } from "@/lib/auth/server";
import { z } from "zod";

const inputSchema = z.object({ name: z.string().min(1).max(200) });

export async function updateSomething(rawInput: unknown) {
  // 1. Auth — must be first, before any input parsing.
  const { accountId } = await requireAuthContext();

  // 2. Input validation — after auth.
  const input = inputSchema.parse(rawInput);

  // 3. Business logic — accountId is trusted, input is validated.
  // ...
}
```

Rules enforced in code review:
- No server action may call a DB client without having called `requireAuthContext` earlier in the same function scope.
- `requireAuthContext` must not be called inside a conditional branch.
- The `accountId` returned from `requireAuthContext` must be used in every DB query as a `WHERE account_id = accountId` clause; never derive `accountId` from the input.

### 4.3 Webhook Signature Verification

When Instagram, Facebook, or any other provider delivers inbound webhooks, the request body must be verified before processing.

**Meta (Facebook/Instagram) webhook verification:**

```typescript
// src/lib/webhooks/verify-meta.ts
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaWebhook(
  rawBody: Buffer,
  signatureHeader: string | null,
): boolean {
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appSecret || !signatureHeader) return false;

  // Header format: "sha256=<hex>"
  const [algo, hex] = signatureHeader.split("=");
  if (algo !== "sha256" || !hex) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(hex, "hex");

  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
```

In the webhook route:

```typescript
export async function POST(request: NextRequest) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const sig = request.headers.get("x-hub-signature-256");

  if (!verifyMetaWebhook(rawBody, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const payload = JSON.parse(rawBody.toString("utf8"));
  // ... process payload
}
```

The GET handler for the Meta webhook challenge verification (hub.verify):

```typescript
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode !== "subscribe") {
    return new Response("Bad request", { status: 400 });
  }

  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN;
  if (!verifyToken || !token) return new Response("Forbidden", { status: 403 });

  const verifyBuf = Buffer.from(verifyToken, "utf8");
  const tokenBuf = Buffer.from(token, "utf8");
  const valid = verifyBuf.length === tokenBuf.length && timingSafeEqual(verifyBuf, tokenBuf);

  if (!valid) return new Response("Forbidden", { status: 403 });
  return new Response(challenge ?? "", { status: 200 });
}
```

### 4.4 Rate Limiting Strategy

| Endpoint | Limit | Window | Key | Backend |
|---|---|---|---|---|
| `POST /api/auth/login` | 8 attempts | 60 s | IP | Supabase table, in-memory fallback |
| `POST /api/auth/magic-link` | 5 attempts | 60 s | IP | Supabase table, in-memory fallback |
| `GET /api/oauth/*/callback` | 20 requests | 60 s | IP | In-memory (low volume endpoint) |
| `GET/POST /api/cron/*` | Not rate-limited (secret-gated) | — | — | — |
| `GET /api/planner/activity` | 60 requests | 60 s | Session user | Supabase table |
| Server actions (general) | None (single-owner, session-gated) | — | — | — |

**Backend selection:**

The current Supabase table backend is appropriate for the single-owner use case. The table has low cardinality (one row per IP prefix per rate-limit window) and the upsert pattern is correct. The in-memory fallback is acceptable because a failed rate-limit for a single-owner app means the legitimate user is the one being rate-limited — erring on the side of leniency is acceptable.

For the rebuild, introduce Redis (Upstash) as the primary backend if Vercel KV is available. This eliminates the per-instance isolation problem (M-1) and removes database load for a non-business-critical concern. Supabase remains as the fallback.

---

## 5. Secrets Management

### 5.1 Environment Variables Inventory

| Variable | Classification | Required in Production | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Yes | Safe to expose in client bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Yes | Subject to RLS; safe to expose |
| `NEXT_PUBLIC_FACEBOOK_APP_ID` | Public | Yes | OAuth client ID; public per Meta docs |
| `NEXT_PUBLIC_SITE_URL` | Public | Yes | Must be production HTTPS URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Yes | Bypasses RLS; server-only |
| `TOKEN_ENCRYPTION_SECRET` | Secret | Yes | New; 32-byte random, base64-encoded |
| `CRON_SECRET` | Secret | Yes | Minimum 32 chars; generated randomly |
| `FACEBOOK_APP_SECRET` | Secret | Yes | Server-only; used in code exchange |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | Secret | Yes | Not truly secret but treat as such |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | Secret | Yes | Server-only |
| `INSTAGRAM_APP_ID` | Secret | Yes | Separate from Facebook App ID |
| `INSTAGRAM_APP_SECRET` | Secret | Yes | Server-only |
| `INSTAGRAM_VERIFY_TOKEN` | Secret | Yes (if webhooks enabled) | Random string |
| `OPENAI_API_KEY` | Secret | Yes | Server-only |
| `RESEND_API_KEY` | Secret | Yes (if email enabled) | Server-only |
| `RESEND_FROM` | Config | Yes (if email enabled) | Not sensitive |
| `ALERTS_SECRET` | Secret | Conditional | Used for alerts endpoint auth |
| `META_GRAPH_VERSION` | Config | No | Defaults to v24.0 |

**Startup validation (rebuild target):**

Replace `readOptionalEnv` with early-fail validation for all secrets. Validate at module load time using a pattern like:

```typescript
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
```

Apply `requireEnv` to every secret-class variable in the `serverEnv` object. Do not defer validation to production-only. A missing secret should cause the server to refuse to start in any environment, making the failure visible immediately rather than at the first request that needs the secret.

### 5.2 Service Role Key Isolation

The service role key (`SUPABASE_SERVICE_ROLE_KEY`) must remain exclusively on the server. Controls:

1. It is accessed only through `src/lib/supabase/service.ts`, which is marked `import "server-only"` (add this import to the file — it is currently missing).
2. `createServiceSupabaseClient` is never called from any file in `src/components/` or any file with `"use client"`.
3. Continuous validation: add a lint rule (`no-restricted-imports`) or a CI check that prevents any file matching `src/components/**` or `src/app/**/page.tsx` (client entry points) from importing `@/lib/supabase/service`.
4. The client used in `src/lib/supabase/client.ts` uses only the anon key. Add `import "client-only"` to that file to mirror the `server-only` pattern.

### 5.3 Rotation Strategy

| Secret | Rotation Frequency | Rotation Procedure |
|---|---|---|
| `TOKEN_ENCRYPTION_SECRET` | Annually or on breach | Re-encrypt all tokens (migration script), swap env var |
| `SUPABASE_SERVICE_ROLE_KEY` | Annually or on breach | Rotate in Supabase dashboard, update env var |
| `CRON_SECRET` | Annually | Generate new random value, update Vercel env var and Vercel Cron config simultaneously |
| `FACEBOOK_APP_SECRET` | On breach only | Rotate in Meta App dashboard |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | On breach only | Rotate in Google Cloud Console |
| `OPENAI_API_KEY` | Annually | Rotate in OpenAI dashboard, update env var |
| `RESEND_API_KEY` | Annually | Rotate in Resend dashboard |
| Social access tokens | Per-provider TTL | Automated by token health job |

All secret rotation events must be logged in a private runbook entry (date, reason, who rotated).

---

## 6. Threat Model

### Threat Scenario Matrix

| # | Scenario | Likelihood | Impact | Primary Mitigation | Secondary Mitigation |
|---|---|---|---|---|---|
| T-1 | Attacker brute-forces magic-link with the owner's email | Medium | High — session takeover | Rate limiting (5/min/IP) | Supabase email OTP has its own rate limit |
| T-2 | Attacker poisons an OAuth state with a captured state UUID (CSRF on callback) | Low (UUID is hard to guess, but callback is open) | High — attacker's platform account gets linked | Bind state to user_id; callback verifies user session | State expiry at 10 minutes |
| T-3 | Supabase database breach — plaintext tokens exposed | Low (Supabase is encrypted at-disk, but dashboard access is a risk) | Critical — attacker can post on all platforms | AES-256-GCM application-layer encryption | Token revocation on incident response |
| T-4 | Compromised `SUPABASE_SERVICE_ROLE_KEY` | Low | Critical — full database read/write, bypasses RLS | Store only in Vercel environment secrets; never log | Rotate immediately on suspicion; monitor Supabase audit log |
| T-5 | XSS via injected script in AI-generated content rendered in the UI | Medium — LLM output is user-visible | High — session hijack, token theft | CSP `script-src 'self'` header; React's default HTML escaping | Content is rendered in controlled editor; not injected as raw HTML |
| T-6 | Timing attack on `CRON_SECRET` comparison | Low (requires network access to cron endpoint) | Medium — allows running cron jobs on demand | `timingSafeEqual` comparison | CRON_SECRET is 32+ random chars |
| T-7 | `CRON_SECRET` leaked via access logs (URL param) | Medium (depends on log configuration) | Medium — attacker can trigger cron at will | Remove URL parameter support; header-only | Vercel logs the full URL by default |
| T-8 | Fake webhook delivery (no signature verification) | High (Meta delivers to a public URL) | Medium — attacker can inject fake event data into the app | HMAC-SHA256 signature verification | Webhooks trigger read-only notification flows; no destructive action |
| T-9 | Session cookie theft via man-in-the-middle | Very Low (HTTPS enforced) | Critical — session hijack | `Secure` + `HttpOnly` cookie flags; HSTS header | Supabase refresh token reuse detection |
| T-10 | Accidental exposure of service role key in client bundle | Low (TypeScript module resolution provides some protection) | Critical — full DB bypass | `import "server-only"` on service.ts; CI lint rule; bundle analysis in CI | Vercel build separates server/client bundles |

---

## 7. Security Checklist for Rebuild

Each item has a testable pass/fail criterion.

### Authentication and Session

- [ ] **MW-1: Middleware validates session on all protected routes.**
  Pass: A request to `/planner` with no session cookie returns a 307 redirect to `/login`. Automated test: Playwright unauthenticated navigation.

- [ ] **MW-2: Middleware refreshes session and writes updated cookies to the response.**
  Pass: An expired access token with a valid refresh token results in a 200 response with a new `sb-access-token` cookie. Test: manually expire the access token, confirm page loads without re-login.

- [ ] **MW-3: `requireAuthContext` is called as the first statement in every server action.**
  Pass: ESLint custom rule or AST check confirms every export in `actions.ts` files calls `requireAuthContext` before any DB operation. CI fails if any action file exports a function that calls a Supabase client before `requireAuthContext`.

- [ ] **MW-4: `accountId` from `requireAuthContext` is used in every DB query in server actions.**
  Pass: Grep for `supabase.from(` in action files — every such call has a `.eq("account_id", accountId)` in the same query chain. Manual review required.

- [ ] **MW-5: Sign-out clears session cookies and invalidates the server-side session.**
  Pass: After sign-out, navigating to `/planner` redirects to `/login`. A cookie copied before sign-out does not grant access after sign-out.

### OAuth Security

- [ ] **OA-1: OAuth state is bound to the authenticated user's session.**
  Pass: The `oauth_states` table has a `user_id` column that is set on insert and verified on callback.

- [ ] **OA-2: OAuth callback verifies `user_id` matches the session before writing `auth_code`.**
  Pass: Calling the callback URL with a valid state UUID but no session returns 401. With a different user's session returns 403.

- [ ] **OA-3: OAuth state expires after 10 minutes.**
  Pass: Attempting to complete OAuth with a state older than 10 minutes returns an error.

- [ ] **OA-4: OAuth state can only be used once.**
  Pass: Replaying the callback URL with a `used_at`-set state returns an error and does not overwrite `auth_code`.

### Token Storage

- [ ] **TS-1: All social access tokens are encrypted at rest.**
  Pass: Querying `social_connections` directly in the Supabase SQL editor returns `access_token_enc` values that are not recognisable as Facebook/Google tokens (i.e. they are ciphertext in the `iv.ct.tag` format).

- [ ] **TS-2: Decryption occurs server-side and decrypted values are never logged.**
  Pass: Searching application logs for known token prefixes (`EAA`, `ya29.`) returns no matches.

- [ ] **TS-3: `TOKEN_ENCRYPTION_SECRET` is 32 bytes decoded.**
  Pass: Startup validation throws if the secret decodes to != 32 bytes. Unit test: `encryptToken` throws with a malformed key.

### API Security

- [ ] **AP-1: Cron secret comparison is timing-safe.**
  Pass: Code review confirms `timingSafeEqual` is used. No string `===` comparison of secrets anywhere in cron routes.

- [ ] **AP-2: Cron secret is never accepted in a URL query parameter.**
  Pass: Calling a cron route with `?secret=<correct>` and no auth header returns 401.

- [ ] **AP-3: Webhook routes verify HMAC-SHA256 signature before processing.**
  Pass: A POST to the webhook route with an incorrect `x-hub-signature-256` header returns 403. A missing header returns 403.

- [ ] **AP-4: `/api/planner/activity` (and any future data-serving API route) validates session explicitly at route level.**
  Pass: The route handler calls `requireAuthContext` or a dedicated `getSessionFromRequest` helper — not inferred from downstream function throws. Unauthenticated GET returns 401.

- [ ] **AP-5: `redirectTo` in magic-link is validated against the application origin.**
  Pass: A magic-link request with `redirectTo: "https://evil.example.com"` is rejected with a 400. A value of `/planner` is accepted.

### Headers and CSP

- [ ] **HD-1: Content-Security-Policy header is set on all HTML responses.**
  Pass: `curl -I https://www.cheersai.uk/login` returns a `Content-Security-Policy` header. The policy includes at minimum: `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'`.

- [ ] **HD-2: `X-Frame-Options: DENY` is set.**
  Pass: Header present in `curl -I` output.

- [ ] **HD-3: `X-Content-Type-Options: nosniff` is set.**
  Pass: Header present.

- [ ] **HD-4: `Strict-Transport-Security` is set with `max-age >= 31536000; includeSubDomains`.**
  Pass: Header present. (Vercel sets this automatically for custom domains with SSL; verify it is not being stripped.)

- [ ] **HD-5: `Referrer-Policy: strict-origin-when-cross-origin` is set.**
  Pass: Header present.

### Secrets Management

- [ ] **SM-1: All required server secrets fail startup if missing (not just in production).**
  Pass: Starting the server with `SUPABASE_SERVICE_ROLE_KEY` unset throws an error and the process exits with a non-zero code.

- [ ] **SM-2: `service.ts` is marked `server-only`.**
  Pass: Attempting to import `@/lib/supabase/service` from a client component results in a Next.js build error.

- [ ] **SM-3: `client.ts` is marked `client-only`.**
  Pass: Attempting to import `@/lib/supabase/client` from a server component results in a build error.

- [ ] **SM-4: Bundle analysis confirms `SUPABASE_SERVICE_ROLE_KEY` is not in any client chunk.**
  Pass: Running `ANALYZE=true next build` and inspecting the client bundle with `@next/bundle-analyzer` shows no occurrence of the service role key value.

- [ ] **SM-5: `.env.local` is in `.gitignore` and contains no committed secrets.**
  Pass: `git log --all -- .env.local` returns empty. `git grep -i "service_role_key"` in all commits returns no secrets. (Run `trufflehog` or `gitleaks` in CI.)

### Data Protection

- [ ] **DP-1: PII (owner email) is not hardcoded in source.**
  Pass: `src/lib/constants.ts` does not contain a bare email address. The email is read from an environment variable.

- [ ] **DP-2: Token values are redacted in all log output.**
  Pass: Searching all log output (in Vercel log drains or local dev) for `access_token` shows only `[REDACTED]` or the first 8 characters followed by `...`, never a full token.

---

## Appendix: Issues Summary Table

| ID | Severity | Issue | File(s) | Fix |
|---|---|---|---|---|
| C-1 | Critical | Middleware has no auth check | `middleware.ts` | Implement session-validating middleware |
| C-2 | Critical | OAuth callback has no session check, allows state poisoning | `api/oauth/[provider]/callback/route.ts` | Bind state to user_id; verify in callback |
| H-1 | High | CRON_SECRET compared with `===` (timing attack) | `api/cron/*/route.ts` | Use `timingSafeEqual` |
| H-2 | High | CRON_SECRET accepted in URL query param (logged in access logs) | `api/cron/*/route.ts` | Remove URL param; header-only |
| H-3 | High | Social OAuth tokens stored in plaintext | `connections/actions.ts`, `social_connections` table | AES-256-GCM application-layer encryption |
| H-4 | High | No CSP or security headers | `next.config.ts` | Add CSP and security headers in `next.config.ts` |
| H-5 | High | `/api/planner/activity` auth is inferred, not explicit | `api/planner/activity/route.ts` | Explicit session check in route handler |
| H-6 | High | Magic-link `redirectTo` not validated against app origin | `api/auth/magic-link/route.ts` | Allowlist or origin-check `redirectTo` |
| M-1 | Medium | Rate-limit in-memory store is per-instance | `auth/rate-limit.ts` | Adopt Redis/Upstash as primary backend |
| M-2 | Medium | IP extraction trusts all forwarded headers | `auth/rate-limit.ts` | Document expected proxy chain; validate on self-hosted |
| M-3 | Medium | Owner email/UUID hardcoded in source | `lib/constants.ts` | Move to environment variables |
| M-4 | Medium | Google location cached across token revocations | `connections/token-exchange.ts` | Clear cache on revocation |
| M-5 | Medium | `signOut` does not clear cookies before redirect | `auth/actions.ts` | Call `clearSupabaseSessionCookies` in `signOut` |
| M-6 | Medium | `service.ts` missing `server-only` import | `supabase/service.ts` | Add `import "server-only"` |
| M-7 | Medium | No webhook signature verification (when routes added) | Not yet implemented | Implement HMAC-SHA256 verification |
| L-1 | Low | Most secrets default to `""` silently | `env.ts` | Use `requireEnv` for all secrets |
| L-2 | Low | Owner email logged on auth failure | `api/auth/login/route.ts` | Remove email from error log |
| L-3 | Low | `resolveAccountId` fallback logic undocumented | `auth/server.ts` | Add trust-boundary comment |
| L-4 | Low | `client.ts` missing `client-only` import | `supabase/client.ts` | Add `import "client-only"` |
