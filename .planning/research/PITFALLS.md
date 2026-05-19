# Pitfalls Research

**Domain:** AI-powered social media management platform for hospitality
**Researched:** 2026-05-18
**Confidence:** HIGH (verified against v1 CONCERNS.md, official Meta/Google docs, OWASP guidance)

## Critical Pitfalls

### Pitfall 1: Silent Token Death

**What goes wrong:**
OAuth tokens for Facebook, Instagram, and GBP expire or get revoked without the application detecting it. Long-lived Facebook tokens expire every 60 days. GBP tokens have shorter windows. Users revoke access on the platform side. The application continues to queue publishes against dead tokens, and posts silently fail. The venue owner discovers days later that nothing was posted.

**Why it happens:**
Developers check token validity at connection time but not at publish time. Token expiry is stored in the database at the moment of exchange but never refreshed. Platforms can revoke tokens outside the 60-day window (policy violations, password changes, app review failures). The v1 codebase had exactly this issue (CONCERNS.md: "Social API Connection Status Not Refreshed Before Publish").

**How to avoid:**
1. Pre-publish token refresh: attempt a lightweight Graph API call (e.g., `GET /me`) before every publish job. If 401, trigger refresh flow or alert.
2. Proactive refresh cron: refresh tokens that expire within 7 days on a daily cron, not just at publish time.
3. Token health dashboard: surface connection status with last-verified timestamp in the UI. Show amber at 7 days before expiry, red at 3 days.
4. Webhook-based revocation detection: register for Facebook's deauthorization callback and GBP's token revocation notifications.

**Warning signs:**
- Publish success rate drops below 95% on any platform
- Token refresh cron skips runs or errors silently
- User complaints about "nothing was posted" with no error notifications sent

**Phase to address:**
Security/Auth foundation phase. Must be solved before any publishing features are built. Token management is load-bearing infrastructure.

---

### Pitfall 2: Duplicate Publishes from Retry Logic

**What goes wrong:**
A publish job fires, the social API accepts it and posts the content, but the response times out or the serverless function cold-starts and QStash retries. The same content gets posted 2-3 times to the venue's Facebook page. For a hospitality venue, duplicate "Happy Hour tonight!" posts look unprofessional and erode trust.

**Why it happens:**
Serverless environments (Vercel Functions) have cold start latency. QStash retries on timeout even if the API call succeeded but the acknowledgment was lost. Without idempotency, the publish handler re-executes the full publish flow. The v1 codebase identified this: "Publish job idempotency -- deduplicate Cron double-fires" (PROJECT.md active requirements).

**How to avoid:**
1. Use QStash message IDs as idempotency keys. Before publishing, check a `publish_attempts` table for the message ID. If found with status "published", return success without re-publishing.
2. Record the platform's post ID (Facebook post_id, Instagram media_id, GBP localPost name) immediately after a successful API call, before any other work.
3. On retry: check for existing platform post ID. If the post exists on the platform, mark as published and skip.
4. QStash deduplication header (`Upstash-Deduplication-Id`) prevents re-enqueue within 10-minute windows, but is not sufficient alone -- handler-side idempotency is still required.

**Warning signs:**
- Any duplicate posts in production (even one is a system-level bug)
- Publish handler execution time exceeding QStash timeout threshold
- Missing `publish_attempts` records for completed publishes

**Phase to address:**
Publish pipeline phase. Idempotency must be designed into the publish handler from day one, not bolted on after duplicates appear.

---

### Pitfall 3: Instagram 200-Call Rate Limit Exhaustion

**What goes wrong:**
Instagram reduced API rate limits from 5,000 to 200 calls per hour per account in 2025 -- a 96% reduction that was unannounced and broke production apps. A carousel publish (create N child containers + 1 parent container + 1 publish + status polling) can consume 15-20 calls. Publishing 10 carousel posts in an hour hits the limit, and subsequent publishes fail with 429 errors. Status polling alone (1 call per minute for 5 minutes per post) burns through the budget fast.

**Why it happens:**
Developers build against the old 5,000/hour limit or don't track per-account call budgets. Carousel publishing is especially expensive because each image needs a separate container creation call. Status polling for media container readiness adds further calls. Multiple campaign types publishing simultaneously compound the problem.

**How to avoid:**
1. Implement a per-account API call budget tracker. Before any API call, check remaining budget from `X-App-Usage` response headers.
2. Spread publishes across time windows -- never burst more than 3-4 posts per hour per account.
3. For carousels: batch container creation and use exponential backoff on status polling (start at 30s, not 1s).
4. Implement circuit breaker: if 429 received, halt all publishes for that account for 15 minutes, then retry.
5. Cache frequently-needed data (account info, page details) to avoid burning calls on reads.

**Warning signs:**
- 429 errors in publish logs for any platform
- Publish queue backing up during peak hours
- Status polling consuming more calls than actual publishes

**Phase to address:**
Publish pipeline phase, but the rate limit tracking infrastructure should be designed in the platform abstraction layer during architecture phase.

---

### Pitfall 4: Unencrypted OAuth Tokens at Rest

**What goes wrong:**
Social platform OAuth tokens (Facebook User Access Tokens, GBP refresh tokens) are stored in plain text in the Supabase database. A database breach, SQL injection, or overly permissive RLS policy exposes tokens that grant full publish access to every connected venue's social accounts. An attacker can post content, delete posts, or revoke access for all connected businesses.

**Why it happens:**
Encryption at rest adds complexity -- key management, rotation, performance overhead on every token read. Developers defer it as "we'll add it later." RLS feels like sufficient protection. But RLS protects row access, not column-level encryption. The v1 audit identified this as critical issue C-3: tokens must be AES-256-GCM encrypted at rest.

**How to avoid:**
1. AES-256-GCM encryption for all OAuth tokens before database storage. Decrypt only in server-side code, never in client queries.
2. Encryption key stored in environment variable (Vercel encrypted env), not in the database.
3. Key rotation plan: support multiple active decryption keys (key ID stored alongside ciphertext) to enable zero-downtime rotation.
4. Minimise token exposure: never log tokens, never include in error messages, never return in API responses.
5. RLS policies on the tokens table should restrict access to service-role only -- no user-facing queries should touch raw token columns.

**Warning signs:**
- Any query that returns token values to client-side code
- Token values appearing in logs or error reports
- No key rotation procedure documented
- Token column accessible via anon-key client

**Phase to address:**
Security foundation phase (Phase 1). This is a prerequisite for any social media connection feature. Must be first.

---

### Pitfall 5: Meta Platform Policy Violations Leading to App Suspension

**What goes wrong:**
Meta's automated enforcement system (active since mid-2025) detects behavioral patterns that suggest automation abuse. An app that publishes too frequently, uses unusual posting patterns, or has users whose accounts get flagged can trigger app-level restrictions. This affects all users of the app, not just the offending account. App review rejection for `instagram_content_publish` scope is also common on first submission.

**Why it happens:**
Developers focus on technical capability without considering platform policy constraints. Common triggers: publishing more than 25 posts/day per account, posting identical content across multiple pages, burst-publishing many posts in quick succession, requesting broader scopes than needed during app review.

**How to avoid:**
1. Rate limit publishing to well below platform maximums: target 3-5 posts/day per account maximum, with minimum 30-minute gaps.
2. Never publish identical content to multiple platforms -- the AI generation should produce genuinely different copy per platform, not just reformatted text.
3. Request only required scopes: `pages_manage_posts`, `instagram_content_publish`, `instagram_basic`. Avoid `instagram_manage_messages` unless needed.
4. App review preparation: document every scope with real screenshots, video walkthroughs, and clear use case descriptions. Budget 2-4 weeks for review cycles.
5. Monitor Meta's Platform Status page and API changelog. Meta ships a new API version every quarter with breaking changes.

**Warning signs:**
- App review rejection (even one rejection delays launch significantly)
- "Reduced API access" notices in Meta Developer Dashboard
- Users reporting their accounts were flagged or restricted after using the app
- Content detection flags on posts made through the API

**Phase to address:**
Platform integration phase. App review preparation should start during development, not after. The provider abstraction layer should enforce rate limits that stay within policy.

---

### Pitfall 6: AI-Generated Content Publishing Embarrassing or Inaccurate Copy

**What goes wrong:**
GPT-4o generates plausible-sounding content with factual errors. For a hospitality venue, this means: wrong opening hours, non-existent menu items, incorrect event dates, fabricated claims ("award-winning chef" when no award exists), or tone-deaf content (cheerful post about drink specials on a solemn occasion). The AI hallucinates at 1.5% of the time for GPT-4o -- across hundreds of generated posts, several will contain errors.

**Why it happens:**
AI models predict likely text sequences, they don't verify facts. Prompts that don't ground the model in specific venue data produce generic or hallucinated content. Without human review, errors ship to live social accounts. The v1 audit notes this isn't just a quality issue -- for hospitality, wrong information (prices, allergen claims, opening times) can have legal consequences.

**How to avoid:**
1. Always include structured venue data in prompts: actual opening hours, real menu items, confirmed event details. Never let the model infer facts.
2. Mandatory human approval for all AI-generated content before publishing. No auto-publish of AI content without explicit approval (except for pre-approved recurring templates).
3. Post-generation validation: check for common hallucination patterns (prices not in venue data, names not in staff list, dates that don't match the event).
4. Tone/brand guardrails: include explicit "never mention" and "always include" lists in prompts (e.g., never mention competitor names, always include the venue's actual address).
5. Keep generated content short -- social posts under 150 words have lower hallucination risk than long-form content.

**Warning signs:**
- Users publishing AI content without reviewing it
- Generated content containing specific factual claims not in the prompt context
- Complaints from venue owners about inaccurate posts
- Auto-publish enabled for AI-generated content

**Phase to address:**
AI content generation phase. Approval workflow must be built alongside generation, not after. The "approve before publish" gate is a safety requirement, not a nice-to-have.

---

### Pitfall 7: GBP API Surface Fragmentation and Silent Deprecation

**What goes wrong:**
Google replaced the monolithic My Business API with a federated suite of purpose-built APIs (Reviews API, Local Posts API, etc.) and continues to deprecate features without long notice periods. The Q&A API was shut down November 2025. Developers build against a specific API surface, then discover endpoints are gone or changed. GBP's token lifecycle is also shorter and less predictable than Meta's.

**Why it happens:**
GBP's API ecosystem is less stable and less well-documented than Meta's Graph API. Google's deprecation notices are shorter. The federated API structure means different endpoints have different versioning, rate limits, and authentication requirements. Many developer resources reference the old monolithic API that was retired in April 2022.

**How to avoid:**
1. Provider abstraction layer: isolate all GBP-specific logic behind an interface. When APIs change, only one module needs updating.
2. Pin to specific API versions and monitor Google's API changelog monthly.
3. Support GBP post types properly: STANDARD, EVENT, and OFFER each have different required fields and validation rules. Don't treat them as interchangeable.
4. GBP token refresh is different from Meta's -- use Google's OAuth2 refresh token flow with proactive refresh (tokens expire in 1 hour, refresh tokens are long-lived but can be revoked).
5. Build graceful degradation: if GBP API returns unexpected errors, log and skip rather than failing the entire publish pipeline.

**Warning signs:**
- GBP-specific errors increasing in logs without code changes
- Google API deprecation emails (subscribe to the Google Cloud Notifications for your project)
- GBP publish success rate diverging from Meta platforms
- GBP post types rendering incorrectly on Google Search/Maps

**Phase to address:**
Platform integration phase. The provider abstraction layer (already planned in PROJECT.md as a key decision) is the primary mitigation. GBP should be treated as the least stable platform.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing tokens unencrypted | Faster initial development | Full breach exposure if DB compromised | Never |
| Shared publish handler for all platforms | Less code to write | Platform-specific error handling becomes impossible; rate limit logic interleaved | Never -- use provider abstraction from day one |
| Polling for publish status instead of webhooks | Simpler implementation | Burns API call budget; adds latency; unreliable at scale | MVP only for GBP (no webhook option); replace with webhooks for Meta ASAP |
| Skipping human approval for AI content | Faster publishing flow | Legal liability from wrong prices/hours/allergen claims; brand damage | Only for pre-approved recurring templates with no AI-generated facts |
| Hard-coding platform API versions | No version management overhead | Silent breakage when Meta/Google deprecate endpoints | Never -- pin versions explicitly and track deprecation schedules |
| Single retry strategy for all platforms | Simpler retry logic | Instagram rate limits need different backoff than Facebook or GBP | MVP only; differentiate retry strategies per platform before scaling |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Facebook Graph API | Treating Page Token as long-lived (it's only valid for 60 days) | Exchange short-lived for long-lived token; refresh proactively at 50 days; store expiry timestamp |
| Instagram Content Publishing | Not checking media container status before publishing | Poll `GET /{container-id}?fields=status_code` until FINISHED; timeout after 5 minutes; handle ERROR status |
| Instagram Carousel | Creating all child containers simultaneously | Create child containers sequentially; each must reach FINISHED status before creating the parent container |
| GBP Local Posts | Using the deprecated My Business API endpoints | Use the federated Business Profile API suite (mybusiness.googleapis.com/v4 for reviews, v1 for accounts) |
| GBP Event Posts | Omitting required event fields (schedule, summary) | Validate all required fields for each post type (STANDARD vs EVENT vs OFFER) before API call |
| OpenAI API | No fallback when API is unavailable | Allow "use my own copy" bypass; queue generation retries; cache recent successful prompts as templates |
| QStash | Relying solely on QStash deduplication (10-minute window) | Implement handler-side idempotency with publish_attempts table; QStash dedup is a first line of defence, not sufficient alone |
| Resend Email | Sending token expiry alerts to email only | In-app notification as primary; email as secondary for urgent alerts. Users check their venue's social accounts, not their email. |
| Supabase Realtime | Subscribing to broad table changes for activity feed | Subscribe to specific rows/filters; unsubscribe on component unmount; handle reconnection after network drops |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded media library queries | Media picker takes 3+ seconds to load | Paginate with cursor-based pagination; index on (account_id, created_at); lazy-load thumbnails | 100+ images per account (tournament content accelerates this) |
| Synchronous AI generation for multi-slot campaigns | 4-5 minute creation time (observed in v1) | Move generation to background job for campaigns with 5+ slots; show progress indicator | 5+ slots x 3 platforms = 15+ OpenAI calls in sequence |
| Polling Instagram container status every second | Burns 300 API calls/hour on status checks alone | Poll at 30s intervals with exponential backoff; cap at 5 minutes | 10+ posts queued for publish in same hour |
| Loading all scheduled content in planner view | Planner page load exceeds 2.5s LCP budget | Server-side pagination; load only visible week/month; prefetch adjacent periods | 50+ scheduled posts per month per venue |
| Supabase connection pool exhaustion under cron load | Random 500 errors on user requests during cron windows | Consolidate cron jobs; use connection pooling (pgbouncer); schedule non-critical crons off-peak | 30+ cron jobs running every 1-5 minutes (observed in v1) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| OAuth state parameter without HMAC validation | CSRF attack: attacker completes OAuth flow and connects their social account to victim's CheersAI account | HMAC-sign the state parameter with a server-side secret; validate on callback. Reject any callback where state doesn't verify. |
| Token values in server action error messages | Token leak via error logging or client-side error display | Never include token substrings in error messages. Use connection IDs for reference. Sanitise all error responses. |
| Service-role Supabase client used in API routes without auth check | Any unauthenticated request can trigger admin operations | Every API route and server action must call `supabase.auth.getUser()` first. Service-role client only for system operations with `// admin operation: [reason]` comments. |
| OAuth redirect URI accepting wildcards or subdomains | Open redirect attack: attacker crafts malicious callback URL | Register exact redirect URIs in Meta/Google developer consoles. Validate redirect_uri matches registered URI exactly on the server side. |
| Publishing queue accessible without per-account auth | User A can publish to User B's social accounts | All publish operations must verify the authenticated user owns the target account connection. RLS on publish_queue table. |
| No CSP header allowing inline scripts | XSS attack can steal OAuth tokens from page context | Strict Content-Security-Policy. No `unsafe-inline`. Nonce-based script loading. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Opaque publish failure messages ("Error 190") | Venue owner has no idea what went wrong or how to fix it | Translate every API error code to plain English with actionable CTA: "Your Instagram connection expired. Reconnect now." |
| No connection health visibility | Owner doesn't know their Facebook token expired until posts stop appearing | Connection status dashboard with traffic-light indicators. Amber at 7 days before expiry. Email alert at 3 days. |
| AI generates content and immediately queues it | Owner publishes AI hallucinations without reading them | Always show generated content for review. "Approve" button is explicit. No auto-publish for AI content. |
| Platform-specific limitations hidden until publish fails | Owner creates a perfect Instagram carousel only to learn one image is too large | Validate media constraints (JPEG, <8MB, aspect ratios) at upload time, not at publish time. Show per-platform requirements in the editor. |
| Scheduling conflicts detected after content creation | Owner creates 3 posts for the same time slot, only discovers conflicts when reviewing the planner | Show conflict warnings during scheduling, not after. The v1 has conflict detection in `scheduling/conflicts.ts` -- surface it in the scheduling UI. |
| No visual difference between draft, scheduled, and published states | Owner can't tell which posts have gone live | Clear status badges with colour coding. "Draft" (grey), "Scheduled" (blue), "Publishing" (amber), "Published" (green), "Failed" (red). |

## "Looks Done But Isn't" Checklist

- [ ] **OAuth flow:** Often missing deauthorization webhook handler -- verify the app handles Facebook deauthorization callbacks and GBP token revocation
- [ ] **Token refresh:** Often missing the "refresh token also expired" case -- verify there's a re-authentication flow when refresh fails
- [ ] **Carousel publishing:** Often missing container status polling -- verify each child container reaches FINISHED before parent creation
- [ ] **Publish retry:** Often missing idempotency check -- verify retried jobs check for existing platform post IDs before re-publishing
- [ ] **AI generation:** Often missing prompt grounding with venue data -- verify prompts include actual venue details (hours, address, menu items)
- [ ] **GBP posts:** Often missing EVENT/OFFER type-specific fields -- verify each post type has correct required fields validated
- [ ] **Rate limiting:** Often missing per-account tracking -- verify rate limit budget is tracked per social account, not just per app
- [ ] **Error notifications:** Often missing the "error notification also failed" case -- verify notification delivery is confirmed (email bounce handling)
- [ ] **Media validation:** Often missing platform-specific format checks -- verify image dimensions, file size, format validated per platform at upload time
- [ ] **Publish audit log:** Often missing the correlation between queue job and platform result -- verify every publish attempt records QStash message ID, platform post ID, and final status

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Silent token death (posts not publishing) | MEDIUM | 1. Run token health audit across all accounts. 2. Trigger re-auth flow for expired tokens. 3. Re-queue failed publishes for the recovery window. 4. Notify affected venue owners with summary. |
| Duplicate publishes | HIGH | 1. Query platform APIs for duplicate posts. 2. Delete duplicates via API (if within edit window). 3. Notify venue owners. 4. Investigate and fix idempotency gap. 5. Audit publish_attempts table for missing records. |
| Rate limit exhaustion | LOW | 1. Pause all publishes for affected account. 2. Wait for rate limit window to reset (1 hour). 3. Re-queue with spread scheduling. 4. Reduce concurrent publish load. |
| AI hallucination published | HIGH | 1. Delete incorrect post via platform API if possible. 2. Notify venue owner immediately. 3. Publish correction if needed. 4. Review and tighten prompt grounding. 5. Consider mandatory review period before AI content goes live. |
| Platform policy suspension | CRITICAL | 1. Appeal via Meta/Google developer support (2-4 week process). 2. All users of the app are affected. 3. Audit publishing patterns that triggered suspension. 4. Implement stricter rate limiting. 5. Have contingency plan: manual posting instructions for venues during appeal. |
| GBP API deprecation breaks publishing | MEDIUM | 1. Disable GBP publishing temporarily. 2. Notify users that GBP posts are paused. 3. Update to new API endpoints. 4. Re-enable and re-queue failed publishes. Provider abstraction layer makes this a localised fix. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Silent Token Death | Security/Auth Foundation | Token refresh cron running; health dashboard showing valid connections; deauthorization webhook registered |
| Duplicate Publishes | Publish Pipeline | Idempotency test: fire same QStash message twice, verify only one platform post created |
| Instagram Rate Limit Exhaustion | Platform Integration | Per-account call budget tracker logging; circuit breaker triggered on 429; no publish burst >4/hour |
| Unencrypted Tokens | Security/Auth Foundation (Phase 1) | Tokens column encrypted in DB; decryption only in service-role server code; key rotation documented |
| Meta Policy Violations | Platform Integration | App review approved; publishing rates within policy limits; no identical cross-platform content |
| AI Content Errors | AI Content Generation | Human approval gate before every publish; prompts include structured venue data; no factual claims without grounding |
| GBP API Fragmentation | Platform Integration | Provider abstraction layer isolates GBP logic; API version pinned; deprecation monitoring active |

## Sources

- [OWASP OAuth2 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html) -- token storage and scope management
- [Meta Graph API Rate Limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) -- per-app and per-page limits
- [Instagram Content Publishing Docs](https://developers.facebook.com/docs/instagram-platform/content-publishing/) -- carousel flow, container status, rate limits
- [QStash Deduplication](https://upstash.com/docs/qstash/features/deduplication) -- dedup headers, 10-minute window, content-based dedup
- [GBP API Status 2026](https://slashpost.ai/blogs/google-business-profile/google-business-profile-api-documentation-2026) -- federated API suite, active endpoints
- [Instagram Graph API Rate Limit Changes](https://www.getphyllo.com/post/instagram-api-integration-101-for-developers-of-the-creator-economy) -- 200 calls/hour reduction
- [OAuth Security in 2026](https://thehgtech.com/guides/oauth-security-attacks-defense-2026.html) -- token replay, refresh token rotation
- [AI Hallucinations and Brand Safety](https://www.amicited.com/blog/ai-hallucinations-brand-safety-protecting-reputation/) -- hallucination rates, human-in-the-loop mitigation
- [Meta Automated Enforcement 2026](https://thetinyfeed.com/meta-automated-bans-explained/) -- behavioral detection patterns, app-level restrictions
- [Supabase API Key Management](https://makerkit.dev/blog/tutorials/supabase-api-key-management) -- encryption patterns, key rotation
- v1 Codebase CONCERNS.md -- direct evidence of token refresh gaps, connection pool exhaustion, generation latency

---
*Pitfalls research for: AI-powered social media management platform for hospitality*
*Researched: 2026-05-18*
