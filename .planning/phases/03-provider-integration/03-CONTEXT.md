# Phase 3: Provider Integration - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect Facebook, Instagram, and Google Business Profile as live providers behind a uniform adapter interface (`PublishingAdapter` with registry pattern). Includes OAuth connection flow, token health monitoring (green/amber/red), rate limit tracking, proactive token refresh, and per-provider error classification. The publishing pipeline itself (QStash, preflight, retry) is Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Connection Health Display
- **D-01:** Health status visible in sidebar AND full connections page. Sidebar shows per-platform dots (FB, IG, GBP) each coloured independently — green/amber/red. Owner sees at a glance which platform needs attention.
- **D-02:** Full connections page uses a card-per-provider layout. Each card shows: status dot, account name, last sync time, token expiry date, and a connect/reconnect button.
- **D-03:** When a connection goes amber or red, show an in-app toast notification on login: e.g. "Instagram token expires in 5 days — reconnect". One-time per session, not persistent. No email alerts in this phase.

### Content Type Mapping
- **D-04:** When content targets a provider that doesn't support the content type (e.g. carousel to GBP), show a warning at create time: "GBP doesn't support carousels — this post will only go to Instagram". Owner decides whether to proceed. No silent skipping, no auto-downgrade.
- **D-05:** Adapter interface uses common base + extensions pattern. Shared base interface (`publishPost`, `publishStory`) plus optional provider-specific methods (`publishOffer`, `publishEvent`). Callers check capability before calling.
- **D-06:** GBP post type (Standard / Event / Offer) selected via explicit picker dropdown in the create flow when GBP is a target platform. No auto-detection.
- **D-07:** Each adapter validates content format before publish via a `validate(content)` method that checks platform-specific rules (image dimensions, character limits, required fields). Fails early with clear errors.

### Claude's Discretion
- OAuth connect flow UX details (modal vs page, step-by-step guidance)
- Error classification implementation (enum structure, retry categorisation)
- Rate limit counter storage approach (database vs in-memory)
- Nightly cron implementation details (QStash vs Vercel Cron)
- Token refresh retry strategy and backoff
- Registry pattern implementation (Map, class-based, or factory)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Platform Requirements
- `.planning/REQUIREMENTS.md` §PLAT-01 through PLAT-10 — All provider integration requirements (adapter interface, per-provider adapters, token refresh, error classification, rate limits, OAuth security, nightly cron)

### Prior Phase Context
- `.planning/phases/01-security-and-auth-foundation/01-CONTEXT.md` — Token vault design (D-01–D-07), auth flow, schema baseline (D-08–D-11), RLS patterns
- `.planning/phases/02-content-engine-and-ai-generation/02-CONTEXT.md` — Content types model, create flow steps, design system identity

### Project Context
- `.planning/PROJECT.md` — Core value proposition, constraints, key decisions
- `.planning/ROADMAP.md` §Phase 3 — Goal, success criteria, dependency chain

### Codebase Patterns
- `.planning/codebase/ARCHITECTURE.md` — Layered server-client architecture, server actions pattern
- `.planning/codebase/CONVENTIONS.md` — Naming patterns, error handling, type conversion (fromDb)
- `.planning/codebase/INTEGRATIONS.md` — Existing integration patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/token-vault/` — AES-256-GCM encryption (crypto.ts, key-management.ts, types.ts, index.ts) — providers store encrypted tokens here
- `src/lib/connections/token-exchange.ts` — Token exchange logic from v1, patterns informative
- `src/lib/meta/` — v1 Meta API code (Graph API patterns, token handling)
- `src/lib/gbp/` — v1 GBP code (API patterns)
- `src/components/ui/status-chip.tsx` — Status indicator component (reuse for health dots)
- `src/components/ui/platform-badge.tsx` — Platform badge component (reuse for provider cards)
- `src/components/ui/card.tsx` — Card component for provider connection cards
- `src/lib/qstash/` — QStash client (for nightly cron jobs)
- `src/lib/logging/` — Structured logging (for provider operation audit trail)

### Established Patterns
- Server actions return `Promise<{ success?: boolean; error?: string }>`
- `fromDb<T>()` converts snake_case DB to camelCase TypeScript
- `requireAuthContext()` for server-side auth verification
- Feature-first directory structure: `src/features/`, shared utilities in `src/lib/`
- Dynamic route pattern: `src/app/api/oauth/[provider]/callback/route.ts` already exists

### Integration Points
- `src/app/(app)/connections/` — Existing connections page route (page.tsx, actions.ts, actions-ads.ts)
- `src/features/connections/` — Connection feature components
- `src/features/settings/management-connection-form.tsx` — Settings connection form
- `src/app/api/cron/notify-expiring-connections/route.ts` — Cron route for expiry notifications
- `src/app/(app)/layout.tsx` — App shell sidebar (where health dots land)
- `src/env.ts` — Env vars for FB, IG, GBP already defined (FACEBOOK_APP_ID/SECRET, INSTAGRAM_APP_ID/SECRET, GOOGLE_MY_BUSINESS_CLIENT_ID/SECRET)

</code_context>

<specifics>
## Specific Ideas

- Per-platform dots in sidebar should be small and non-intrusive — think three tiny coloured circles next to the "Connections" nav item
- Provider cards should feel consistent with the rest of the design system (card.tsx with status-chip.tsx and platform-badge.tsx)
- Toast on login should be actionable — tapping it navigates to the connections page

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-provider-integration*
*Context gathered: 2026-05-19*
