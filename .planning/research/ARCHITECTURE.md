# Architecture Patterns

**Domain:** AI-powered social media management platform for hospitality
**Researched:** 2026-05-18

## Recommended Architecture

A layered architecture with four distinct domains connected by an event-driven publishing pipeline. The v1 already follows a reasonable layered pattern; the v2 must formalise component boundaries, add a proper provider abstraction registry, replace direct cron with QStash-driven background jobs, and encrypt tokens at rest.

```
+------------------+     +------------------+     +--------------------+
|  Presentation    |     |  Content Engine   |     |  Provider Registry |
|  (Next.js App    |---->|  (AI generation,  |---->|  (Facebook, IG,    |
|   Router, React) |     |   versioning,     |     |   GBP adapters)    |
|                  |     |   scheduling)     |     |                    |
+------------------+     +------------------+     +--------------------+
        |                        |                         |
        v                        v                         v
+------------------+     +------------------+     +--------------------+
|  Auth & Identity |     | Publishing       |     | Token Vault        |
|  (Supabase Auth, |     | Pipeline         |     | (AES-256-GCM       |
|   middleware,    |     | (QStash queue,   |     |  encrypted store,  |
|   RBAC)          |     |  preflight,      |     |  refresh engine,   |
|                  |     |  retry/backoff)  |     |  health monitor)   |
+------------------+     +------------------+     +--------------------+
        |                        |                         |
        +------------------------+-------------------------+
                                 v
                    +------------------------+
                    | Data Layer             |
                    | (Supabase PostgreSQL,  |
                    |  RLS, audit log,       |
                    |  Realtime)             |
                    +------------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | Boundary Rule |
|-----------|---------------|-------------------|---------------|
| **Presentation** | UI rendering, form handling, React Query data fetching, Framer Motion animations | Content Engine (via server actions), Auth (context provider) | Never calls providers or token vault directly |
| **Auth & Identity** | Supabase JWT cookies, middleware guard, session verification, rate limiting | Data Layer (user/account tables), all server actions (via `requireAuthContext`) | Every mutation re-verifies server-side; no client-side-only auth checks |
| **Content Engine** | AI generation, content versioning (drafts/variants), scheduling, conflict detection, media library | Presentation (receives inputs), Publishing Pipeline (enqueues jobs), Data Layer (content/media tables) | Owns `content_items`, `content_variants`, `media_assets` tables |
| **Provider Registry** | Platform-specific API adapters (Facebook Graph, Instagram Graph, GBP API); format normalisation; rate limit awareness | Publishing Pipeline (receives publish commands), Token Vault (requests decrypted tokens) | Each provider is a standalone adapter behind a common interface; no cross-provider imports |
| **Publishing Pipeline** | Preflight validation, QStash job enqueue/dequeue, retry with backoff (5m/15m/45m, 4 max), idempotency, status tracking, failure recovery | Content Engine (reads content), Provider Registry (executes publish), Token Vault (checks token health), Data Layer (publish_jobs table), Notification system (failure/success alerts) | Stateless handlers; all state in `publish_jobs` table; idempotency via QStash message ID |
| **Token Vault** | AES-256-GCM encryption/decryption of OAuth tokens, proactive refresh scheduling, token health monitoring, expiry alerts | Provider Registry (supplies decrypted tokens), Data Layer (encrypted token storage), Notification system (expiry warnings) | Only module that holds encryption keys; tokens never leave vault unencrypted except into provider adapters |
| **Data Layer** | Supabase PostgreSQL with RLS, audit logging, Realtime subscriptions, snake_case schema | All components read/write through this layer | All access via typed query helpers with `fromDb<T>()` conversion |

### Data Flow

#### Content Creation (Happy Path)

```
User -> [Presentation] Form submission
     -> [Server Action] requireAuthContext() + Zod validation
     -> [Content Engine] AI generates platform-specific variants
     -> [Data Layer] INSERT content_items (status: 'draft')
     -> [Data Layer] INSERT content_variants (one per platform)
     -> [Presentation] React Query invalidation, show editor
```

#### Publish Pipeline (Scheduled Post)

```
User approves post -> [Server Action] schedule content
  -> [Content Engine] Conflict detection, scheduling
  -> [Publishing Pipeline] Preflight check (connection, token, media, lint)
  -> [Publishing Pipeline] enqueuePublishJob -> QStash publishJSON
  -> [Data Layer] INSERT publish_jobs (status: 'queued')
  -> [Data Layer] UPDATE content_items (status: 'scheduled')

[At scheduled time] QStash delivers -> /api/publish/execute endpoint
  -> [Publishing Pipeline] Verify QStash signature, check idempotency
  -> [Token Vault] Decrypt token for target provider
  -> [Provider Registry] providerRegistry.get(platform).publish(content, token)
  -> [Data Layer] UPDATE publish_jobs (status: 'published' or 'failed')
  -> [Data Layer] logAuditEvent()
  -> [Notification] Success: activity feed via Realtime; Failure: email via Resend

[On failure] QStash retry with backoff (5m -> 15m -> 45m -> dead letter)
  -> [Publishing Pipeline] Same flow, attempt_count incremented
  -> [After max retries] UPDATE publish_jobs (status: 'failed_permanent')
  -> [Notification] Email alert with plain-English root cause
```

#### Token Lifecycle

```
[OAuth Connect] User initiates -> /api/oauth/{provider}/callback
  -> [Auth] Validate HMAC state parameter
  -> [Token Exchange] exchangeProviderAuthCode(provider, code)
  -> [Token Vault] Encrypt tokens with AES-256-GCM
  -> [Data Layer] UPSERT social_connections (encrypted tokens, expires_at)

[Proactive Refresh] Cron (QStash scheduled, daily)
  -> [Token Vault] Query connections where expires_at < now + 7 days
  -> [Token Vault] For each: decrypt refresh_token, call provider refresh endpoint
  -> [Token Vault] Re-encrypt new tokens, UPDATE social_connections
  -> [Notification] If refresh fails: email alert + in-app "needs_action" status

[Token Health Check] Before every publish
  -> [Publishing Pipeline] Preflight verifies token not expired
  -> [Token Vault] If expiring within 1 hour: attempt inline refresh
  -> If refresh fails: block publish, return actionable error
```

## Patterns to Follow

### Pattern 1: Provider Registry (Strategy + Registry)

Each social platform is an adapter implementing a common interface. New platforms (TikTok, LinkedIn) plug in without touching pipeline code.

```typescript
// src/lib/providers/types.ts
interface ProviderAdapter {
  readonly platform: 'facebook' | 'instagram' | 'gbp';
  
  publish(params: PublishParams): Promise<PublishResult>;
  validateContent(content: ContentVariant): ValidationResult;
  getContentLimits(): PlatformLimits;
  refreshToken(refreshToken: string): Promise<TokenRefreshResult>;
}

// src/lib/providers/registry.ts
const providerRegistry = new Map<string, ProviderAdapter>();

export function registerProvider(adapter: ProviderAdapter): void {
  providerRegistry.set(adapter.platform, adapter);
}

export function getProvider(platform: string): ProviderAdapter {
  const adapter = providerRegistry.get(platform);
  if (!adapter) throw new Error(`No adapter registered for ${platform}`);
  return adapter;
}

// src/lib/providers/facebook/adapter.ts
export const facebookAdapter: ProviderAdapter = {
  platform: 'facebook',
  async publish(params) { /* Facebook Graph API calls */ },
  validateContent(content) { /* Facebook-specific validation */ },
  getContentLimits() { return { maxBodyLength: 63206, maxImages: 10, supportsStories: true }; },
  async refreshToken(token) { /* Facebook long-lived token exchange */ },
};
```

**Why this pattern:** The v1 already has provider-specific code scattered across `src/lib/meta/`, `src/lib/gbp/`, and `src/lib/connections/`. The registry pattern consolidates platform-specific logic behind a uniform interface, making preflight checks and publishing logic platform-agnostic.

### Pattern 2: Content State Machine

Content items follow an explicit state machine. Transitions are enforced in the data layer, not scattered across UI components.

```typescript
// Valid state transitions for content_items.status
type ContentStatus = 'draft' | 'review' | 'approved' | 'scheduled' | 'queued' | 'publishing' | 'published' | 'failed';

const VALID_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft:      ['review', 'approved'],
  review:     ['draft', 'approved'],
  approved:   ['scheduled', 'queued'],    // queued = publish now
  scheduled:  ['queued', 'draft'],         // can unschedule back to draft
  queued:     ['publishing'],
  publishing: ['published', 'failed'],
  published:  [],                          // terminal
  failed:     ['queued', 'draft'],         // retry or edit
};
```

**Why this pattern:** The v1 has implicit status tracking (`scheduled`, `queued` in `markContentScheduled`). Explicit state machines prevent invalid transitions (e.g., publishing a draft) and make the UI deterministic -- each status maps to exactly one set of available actions.

### Pattern 3: Publish Job Idempotency

QStash message IDs serve as idempotency keys. Every publish endpoint checks for duplicate delivery before executing.

```typescript
// In /api/publish/execute handler
const messageId = request.headers.get('Upstash-Message-Id');
const existing = await db
  .from('publish_jobs')
  .select('id, status')
  .eq('idempotency_key', messageId)
  .maybeSingle();

if (existing?.status === 'published') {
  return Response.json({ deduplicated: true });
}
```

**Why this pattern:** QStash can deliver messages more than once (at-least-once semantics). Without idempotency, a retry after a timeout could double-post to Facebook/Instagram.

### Pattern 4: Token Vault with Application-Level Encryption

Encrypt OAuth tokens before database storage; decrypt only when needed for API calls.

```typescript
// src/lib/tokens/vault.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encryptToken(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptToken(encrypted: { ciphertext: string; iv: string; tag: string }): string {
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
```

**Why this pattern:** The v1 stores OAuth tokens in plaintext in `social_connections.access_token`. This is a critical security issue (C-3 in PROJECT.md). Application-level encryption means tokens are protected even if the database is compromised. Supabase provides at-rest encryption, but that protects against disk-level attacks, not application-level data exposure.

### Pattern 5: Platform-Specific Content Variants

One content item spawns multiple variants, one per platform. Each variant holds platform-specific copy, media references, and formatting.

```
content_items (1) ---> content_variants (N, one per platform+placement)
   |                        |
   | id                     | content_item_id (FK)
   | account_id             | platform ('facebook'|'instagram'|'gbp')
   | type ('post'|'story')  | placement ('feed'|'story')
   | status                 | body (platform-specific copy)
   | scheduled_for          | media_ids (references to media_assets)
   | prompt_context         | ai_generation_params (tone, length, CTA)
   |                        | version (integer, increments on edit)
```

**Why this pattern:** The v1 already uses `content_variants` but lacks version tracking. Adding a version column enables "regenerate with modifier" (keeping old version for comparison) and audit trails for content changes.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Polling for Publish Status
**What:** Client components polling `/api/status` to check if a post published.
**Why bad:** Wastes server resources, adds latency, scales poorly.
**Instead:** Use Supabase Realtime subscriptions on `publish_jobs` table. Client subscribes to row changes filtered by `account_id`. Status updates push instantly.

### Anti-Pattern 2: Provider Logic in Server Actions
**What:** Facebook Graph API calls directly inside server action functions.
**Why bad:** Tight coupling means every new platform requires modifying existing server actions. Testing requires mocking the specific provider.
**Instead:** Server actions call the Publishing Pipeline, which uses the Provider Registry. Provider adapters are independently testable.

### Anti-Pattern 3: Storing Tokens Unencrypted
**What:** Plaintext OAuth tokens in the database (v1 pattern).
**Why bad:** Database compromise exposes all social media accounts. Supabase RLS protects against unauthorized user access, but not against admin-level breaches or backup exposure.
**Instead:** Token Vault with AES-256-GCM. Tokens decrypted only in-memory, only when needed for API calls.

### Anti-Pattern 4: Monolithic Preflight
**What:** Single preflight function that checks everything sequentially.
**Why bad:** The v1's `getPublishReadinessIssues()` is already 160+ lines with mixed concerns (connection checks, media validation, content linting). Adding platforms multiplies complexity.
**Instead:** Compose preflight from independent checkers: `connectionChecker`, `mediaChecker`, `contentLinter`, `tokenHealthChecker`. Each returns issues independently; pipeline aggregates.

### Anti-Pattern 5: Implicit State Transitions
**What:** Updating `content_items.status` from anywhere without validating the transition.
**Why bad:** Race conditions can put content into impossible states (e.g., `draft` -> `published` bypassing preflight).
**Instead:** Centralised `transitionContentStatus(id, fromStatus, toStatus)` function that validates against the state machine and uses a database-level check (`WHERE status = expected_status`).

## Token Lifecycle Details by Provider

Understanding token lifecycles is critical for the refresh engine.

| Provider | Access Token TTL | Refresh Mechanism | Refresh Token TTL | Special Notes |
|----------|-----------------|-------------------|-------------------|---------------|
| **Facebook** | ~60 days (long-lived page token) | Exchange short-lived for long-lived; page tokens derived from user token | Page tokens don't expire if user token was long-lived | Must re-exchange if user revokes app permission |
| **Instagram** | ~60 days (via Facebook page token) | Same as Facebook (Instagram uses FB page token) | Same as Facebook | Linked through Facebook Page; no independent refresh |
| **GBP (Google)** | ~1 hour | Standard OAuth2 refresh_token grant | Never expires (unless revoked or 6 months unused) | Testing-status apps: 7-day refresh token expiry. Max 50 refresh tokens per user per client. |

**Implications for refresh engine:**
- Facebook/Instagram: Refresh once every 50 days (well before 60-day expiry). One refresh covers both platforms if they share a page token.
- GBP: Refresh every 45-50 minutes (before 1-hour expiry), or refresh on demand before each publish. Store refresh_token permanently; only access_token rotates.
- The refresh cron should run daily and catch tokens expiring within 7 days. For GBP, an additional just-in-time refresh before publish is necessary.

## Scalability Considerations

| Concern | At 10 venues | At 100 venues | At 1000 venues |
|---------|-------------|---------------|----------------|
| **Publish throughput** | Direct QStash, no batching needed | QStash rate limit (default 500 msg/s) is sufficient | May need QStash queue partitioning by account |
| **Token refresh** | Single cron run, sequential refresh | Batch refresh in parallel (Promise.allSettled) | Stagger refresh across time windows to avoid provider rate limits |
| **Content storage** | Single Supabase instance | Single Supabase instance with proper indexing | Consider read replicas for analytics queries |
| **Media storage** | Supabase Storage, no CDN needed | Supabase Storage with CDN (Vercel Edge) | Dedicated media CDN, consider image optimization service |
| **Realtime subscriptions** | Supabase Realtime handles easily | Monitor connection count (Supabase free: 200 concurrent) | May need Realtime channel partitioning |

## Suggested Build Order

Components have natural dependencies that dictate build order:

```
Phase 1: Foundation (no external dependencies)
  Auth & Identity -> Data Layer (schema) -> Token Vault

Phase 2: Core Engine (depends on Phase 1)
  Content Engine (AI, variants, scheduling) -> Media Library

Phase 3: Provider Integration (depends on Phase 1 + 2)
  Provider Registry (adapters) -> Token Lifecycle (refresh engine)

Phase 4: Publishing Pipeline (depends on all above)
  Preflight -> QStash Queue -> Retry/Backoff -> Status Tracking

Phase 5: Realtime & Notifications (depends on Phase 4)
  Activity Feed (Supabase Realtime) -> Email Alerts (Resend)

Phase 6: Analytics & Polish (depends on Phase 4)
  Engagement Analytics -> Link-in-Bio -> Performance Budgets
```

**Build order rationale:**
- Auth and schema must exist before anything else can be built or tested.
- Token vault must exist before provider adapters can function (encrypted token storage).
- Content engine is independent of providers -- you can build and test content creation, AI generation, and scheduling without social platform connections.
- Provider adapters depend on token vault for credential access.
- Publishing pipeline ties everything together and is the highest-risk component. Building it last means all dependencies are stable.
- Analytics and link-in-bio are read-heavy features that consume data produced by the publishing pipeline. They can be built in parallel once the pipeline exists.

## Sources

- [Meta Developer Docs: Access Token Guide](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
- [Meta Developer Docs: Long-Lived Tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/)
- [Meta Developer Docs: Instagram Refresh Token](https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/)
- [Google Developer Docs: OAuth for Business Profile APIs](https://developers.google.com/my-business/content/implement-oauth)
- [Google Developer Docs: Using OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://datatracker.ietf.org/doc/rfc9700/)
- [Upstash QStash Documentation: Next.js Quickstart](https://upstash.com/docs/qstash/quickstarts/vercel-nextjs)
- [Upstash QStash: Serverless Background Jobs](https://dev.to/whoffagents/upstash-qstash-serverless-background-jobs-without-the-infrastructure-pain-ic8)
- [Postproxy: Unified Social Media API](https://postproxy.dev/)
- [Zernio: Unified Social Media API](https://zernio.com/blog/unified-social-media-api)
- [Supabase Security Documentation](https://supabase.com/security)
- [CipherStash: Sensitive Data Encryption with Supabase](https://cipherstash.com/blog/securing-sensitive-data-with-cipherstash-protectjs-and-supabase)
- v1 codebase analysis: `src/lib/publishing/`, `src/lib/connections/`, `src/lib/meta/`, `src/lib/gbp/`
