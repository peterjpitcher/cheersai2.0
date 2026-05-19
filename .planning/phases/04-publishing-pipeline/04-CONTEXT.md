# Phase 4: Publishing Pipeline - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Content moves reliably from approved to published across all three platforms (Facebook, Instagram, GBP), with idempotent QStash delivery, composed preflight checks, retry/backoff, and plain-English failure recovery. Covers the full state machine (draft → review → approved → scheduled → queued → publishing → published/failed), audit logging, structured logging, failure email alerts, and MSW integration tests.

</domain>

<decisions>
## Implementation Decisions

### Approval Flow
- **D-01:** Review state is always required — every piece of content must pass through review before it can be approved. No skip-to-approved shortcut.
- **D-02:** Approval happens within the creation flow itself. After the AI generates platform-specific copy and the owner reviews it, they approve right there in the wizard. No separate review queue page, no planner-based approval.
- **D-03:** Bulk approve (CONT-09) is dropped. Not needed — recurring campaigns already auto-publish after first approval (`auto_confirm = true`, Phase 2 decision). Individual content is approved in the create flow.
- **D-04:** After approval, content auto-queues at the scheduled time. If scheduled for now, it publishes immediately. No extra confirmation step between approve and queue.

### Claude's Discretion
- Failure recovery UX: where failures surface (planner banner, toast, dedicated tab), what the retry button does, whether retry re-runs preflight, what plain-English errors look like per error type
- Preflight error presentation: when preflight checks block (at approval, scheduling, or publish time), what fix-it CTAs look like, whether all checks run at once or progressively
- Publishing status visibility: how the 7-state machine surfaces in the planner and elsewhere, real-time feedback during publishing
- QStash dispatch pattern: cron-poll vs event-driven, message format, multi-platform orchestration for a single content item
- Retry/backoff implementation details (5m/15m/45m schedule, QStash-native vs handler-side)
- Idempotency key strategy (QStash message ID vs content-derived key)
- Audit log entry structure for publish attempts
- Structured logging correlation IDs and job duration tracking
- MSW integration test approach and mock provider setup
- Email alert template and trigger conditions

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Publishing Pipeline Requirements
- `.planning/REQUIREMENTS.md` §PUB-01 through PUB-09 — QStash queue, idempotency, retry/backoff, failure recovery, state machine, audit log, structured logging, email alerts
- `.planning/REQUIREMENTS.md` §CONT-09 — Bulk approve (DROPPED by user decision D-03 — do not implement)
- `.planning/REQUIREMENTS.md` §CONT-10 — Pre-flight errors in plain English with actionable CTAs
- `.planning/REQUIREMENTS.md` §TEST-01 — Coverage thresholds: publishing >=85%
- `.planning/REQUIREMENTS.md` §TEST-02 — MSW integration tests for all provider API flows

### Prior Phase Context
- `.planning/phases/01-security-and-auth-foundation/01-CONTEXT.md` — Token vault design (D-01–D-03), schema baseline with publish_jobs table (D-08–D-09), RLS patterns (D-11), coverage targets (D-13)
- `.planning/phases/03-provider-integration/03-CONTEXT.md` — Adapter interface with validate() (D-05, D-07), content type mapping warnings (D-04), registry pattern

### Project Context
- `.planning/PROJECT.md` §Key Decisions — Decision #4: no download ZIP fallback, invest in retry UX; Decision #2: QStash over Vercel Cron
- `.planning/ROADMAP.md` §Phase 4 — Goal, success criteria, dependency chain

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/publishing/preflight.ts` — Full preflight system: connection status, token validity, media checks, content lint. Ready for pipeline integration.
- `src/lib/publishing/queue.ts` — Basic enqueue (`enqueuePublishJob`) + `markContentScheduled`. Inserts to `publish_jobs` table. Needs QStash integration.
- `src/lib/qstash/client.ts` — QStash client (message publishing), receiver (signature verification), `verifyQStashSignature()`. Ready for webhook handler.
- `src/lib/providers/registry.ts` — Adapter registry: `getAdapter(platform)`, `registerAdapter()`, `listRegisteredPlatforms()`. Pipeline calls this to dispatch per-platform publishes.
- `src/lib/providers/types.ts` — `PublishingAdapter` interface with `publishPost()`, `publishStory()`, `validate()`. GBP extends with `publishEvent()`, `publishOffer()`.
- `src/lib/providers/{facebook,instagram,gbp}/adapter.ts` — Three live adapters registered in `src/lib/providers/init.ts`.
- `src/app/api/cron/notify-failures/route.ts` — Email notification for failed publishes with idempotency via notifications table. Pattern reusable for PUB-09.
- `src/lib/logging/` — Structured logging with Axiom, correlation IDs available.
- `src/lib/email/resend.ts` — `sendEmail()` helper for Resend.

### Established Patterns
- Server actions return `Promise<{ success?: boolean; error?: string }>`
- `fromDb<T>()` converts snake_case DB to camelCase TypeScript
- `requireAuthContext()` for server-side auth verification
- `createServiceSupabaseClient()` for system/pipeline operations (bypasses RLS)
- Feature flags via env vars (INFRA-03)

### Integration Points
- `src/app/api/cron/publish/route.ts` — Current cron publish trigger (calls Supabase Edge Function). Needs rewrite to QStash webhook handler.
- `src/app/(app)/create/actions.ts` — Create flow actions where approval will trigger scheduling
- `src/lib/providers/errors.ts` — Error classification (auth, rate limit, content rejection, transient) for plain-English error mapping
- `src/types/content.ts` — Content type definitions including status field for state machine
- `src/components/ui/status-chip.tsx` — Status indicator component for state machine visualisation

</code_context>

<specifics>
## Specific Ideas

- Approval is a natural end-step of the create wizard — the owner reviews AI output and hits "Approve & Schedule" in one flow
- Recurring campaigns with `auto_confirm = true` don't need re-approval after first time — they auto-publish on their weekly schedule

</specifics>

<deferred>
## Deferred Ideas

- **Bulk approve dropped** — CONT-09 removed by user decision. Not needed given recurring auto-publish and in-flow approval.

</deferred>

---

*Phase: 04-publishing-pipeline*
*Context gathered: 2026-05-19*
