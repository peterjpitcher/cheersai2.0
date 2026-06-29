# Fix-Function — Create Flow Remediation — Defect Log

Base commit: `b0df95e` · Branch: `feat/gbp-removal-recurrence-rework` · Date: 2026-06-29
Live DB validated: project `nbkjciurhvkfpcpatbnt` (cheersai2.0).

## Live-schema facts (validated, not from migrations)
- `publish_jobs` (960 rows): **no `platform` column** (has `placement`, `variant_id`, `account_id`, `platform_post_id`).
- `content_variants` (963 rows): **no `platform` column**; ~1 row per `content_item_id` (NOT per platform).
- `content_items`: **has `platform` (text)** + `placement` — this is where platform lives (one content row per platform).
- `publish_jobs` status: succeeded 840, failed 13, queued 107. `publish_attempts` table is **empty**. `platform_post_id` is NULL on all rows.

## Key architectural finding (pre-existing, not introduced by my changes)

**FF-001 — Two divergent publish workers; the live one is the edge function, and the Next.js `handler.ts` does not match the live schema.**
- Type: maintainability / data risk (dead-vs-live divergence) · Severity: High · Confidence: High
- Evidence:
  - Live production worker = `supabase/functions/publish-queue/worker.ts` (Deno edge function). It is **placement-based**: `requiresCopy = content.placement !== 'story'` (worker.ts:701), `copy = content.placement === 'story' ? '' : rawCopy` (:714), loads platform from `content_items.platform` (:1125), dispatches `publishByPlatform(content.platform, …)` (:827). Sets status `succeeded`, writes `last_error`/`error_message`. Matches live data (status `succeeded`, empty `publish_attempts`, error strings like `[instagram_create_container]`).
  - Next.js `src/lib/publishing/handler.ts` (`processPublishJob`) selects `platform` from `publish_jobs` (handler.ts:53) and `platform` from `content_variants` (handler.ts:288/295), uses `publish_attempts`, sets status `published`. **These selects 42703 against the live schema** → handler.ts cannot run against production as-is. Live evidence corroborates handler.ts is NOT the active worker (no publish_attempts rows; statuses are `succeeded` not `published`).
  - The wizard dispatches to `/api/webhooks/qstash-publish` → `processPublishJob` (handler.ts). So the create flow points at the worker that does not match the live schema, while the edge function is what actually drains the queue in production.
- Impact: Confusing duality; the Next.js publish pipeline is effectively dead/aspirational against the live DB. Risk of future work targeting the wrong worker.
- Recommendation: **Out of scope for this create-flow pass (risky, architectural).** Flag for a dedicated decision: consolidate on the edge-function worker (delete/retire handler.ts + queue v2-mode + publish_attempts), OR migrate the live schema to the v2 shape handler.ts expects. Do NOT rewrite in this pass.

## Impact of my create-flow changes on the LIVE worker
- **Recurring stories WILL publish correctly in production.** `createScheduledBatch` writes `content_items.placement = 'story'` for weekly stories; the live edge-function worker keys story behaviour off `content.placement === 'story'` (worker.ts:701/714/1246) — empty copy, story-cropped media (`derived_variants.story`), story publish. Same prerequisites as the existing `story` content type.
- My `handler.ts buildContentPayload` story-dispatch fix is correct but only affects the secondary (non-live) worker — harmless, leaves handler.ts more correct if ever activated.

## Remediation status (this pass)

### FIXED + verified (safe, tied to the recurrence/story changes or clear data-integrity)
| ID | Fix | File |
|----|-----|------|
| C1 | Roll back inserted content_items/campaign when the `content_variants` upsert fails (was: orphaned rows → silent recurring publish failures) | content.ts (variantError branch) |
| M3 (scoped) | Reject a **weekly-recurring story** with no media before scheduling, instead of scheduling a blank/failed story | content.ts (after placement guard) |
| M2 | Generic "No content to schedule — select at least one platform." for the empty-rows fallback (was: a misleading "stories" message for feed posts) | content.ts |
| (story job) | Pass `placement` to `enqueueAndDispatch` so story jobs carry the right placement on the publish_jobs row | content.ts enqueue loop |
| F4 | Reset `selectedSlots`/`generatedSlotCopies`/`lastGenerationContext` on content-type change (was: weekly's auto-derived slots leaked onto event/promotion) | create-wizard.tsx |
| F2 | Don't gate the weekly Next button on `selectedSlots` (auto-derived/read-only) — removes the first-click race dead-end | create-wizard.tsx |
| tests | weekly-story batch creates story rows w/ empty body; weekly story w/o media rejected; weekly placement schema default/story | content.test.ts, content-schemas.test.ts |

Verification: `tsc` 0 errors · eslint 0 warnings · 1556 tests pass · build OK.

### RISKY / out-of-scope — batched for your approval (NOT applied)
| ID | Finding | Why deferred |
|----|---------|--------------|
| FF-001 | Two divergent publish workers; Next.js `handler.ts` selects `publish_jobs.platform`/`content_variants.platform` which don't exist live and isn't the live worker (edge function is). | Architectural decision (consolidate on edge worker vs migrate schema). Risky; needs your call. |
| C2 | `createScheduledBatch` never re-validates `brief` server-side (trusts raw `form.getValues()`); also `slotCopies`/`platforms`/`mode` untyped at runtime. | Security/contract — a Zod gate could reject currently-passing payloads; wants a deliberate rollout. |
| H1 | No `logPublishAuditEvent` on `createScheduledBatch`/`deleteDraft`/`scheduleContent` (CLAUDE.md mandates it). | Audit `operationType` union has no schedule/create value — needs an audit-contract change. |
| H2 | Re-running a batch after a mid-loop failure creates duplicate publishes (no natural dedup key on draft+slot+platform). | Publishing contract; needs a dedup-key design. |
| H3 | `getCalendarItemsAction` range filter uses two independent `.or()` groups + string timestamp compare → can over-fetch / mis-drop boundary items across BST. | Query semantics; needs careful rework + tests. |
| M3 (broad) | Story/event/promotion **story placements** with no media are also schedulable (same gap, broader than weekly). | Contract change — rejects flows the existing promotion test relies on; confirm with product. |
| M1 | `scheduleContent` future-check uses raw `new Date()`/`Date.now()` instead of Luxon/Europe-London. | Low-risk but a separate action; logic-equivalent — easy follow-up. |
| svc | `src/lib/create/schema.ts`/`service.ts` carry a large dead legacy campaign path (`weeklyCampaignSchema`, `scheduleModeEnum`, `create*Campaign`, `buildSpreadEvenlyPlans`). | Large deletion; verify no test-only imports first. |
| DB | Drop empty `gbp_reviews`/`gbp_daily_metrics`, GBP columns, delete the 1 live Google connection (PR2). | Destructive — explicit approval required (workspace rule). |

### Additional SAFE-but-pre-existing items available on request (not applied to keep this pass scoped)
F7 double-submit guards · F8 surface per-slot generate failures · F9 `proofPoints` `defaultValue` desync on type-switch/resume · F10 weekly "select a date" copy never applies · F11 radio-group roving-focus a11y · M4 document the service-role RLS-bypass invariant · F3/F5 weekly slots derived from `now()` at render can drift / draft-resume re-dates (needs a stable anchor).

## Round 2 — batched items resolved (user approved "fix them all")

| ID | Resolution | Commit |
|----|-----------|--------|
| PR2 (DB) | GBP tables/columns dropped, GBP connection+oauth_states deleted, applied to prod & verified (token_vault cascaded, queue intact) | `2e59811` |
| FF-001 | Root cause was narrow: `enqueueAndDispatch` ignored the established legacy-bridge mode. Now skips the QStash→handler.ts dispatch in legacy-bridge (the edge-function worker drains queued jobs ≤1 min). +test. | `3a4b6c7` |
| C2 | Server-side brief re-validation in `createScheduledBatch` (validate-only, keeps original object). +test fixtures completed. | `07f1fd2` |
| H3 | Calendar range filter → OR-of-ANDs + millisecond comparison (BST-safe). | `07f1fd2` |
| M1 | `scheduleContent` future-check via Luxon/Europe-London. | `07f1fd2` |
| M3 (broad) | Story-media guard now covers all story placements. +promotion test updated. | `07f1fd2` |
| H1 | Best-effort `audit_log` write on `createScheduledBatch` success (non-fatal). | `76b4f6f` |
| H2 | Substantially mitigated: rollback (C1) cleans `publish_jobs`+rows on failure, draft-delete-on-success blocks re-runs, and F7 guards concurrent clicks. No separate dedup key added. | `b23ce71`/`8afd013` |
| F7/F8/F9 | Double-submit guards; surface batch generate failures; proof-points remount. | `8afd013` |
| generate-stream | Per-account rate limiter (429), wrapped domain-input parse (400), failure logging. | `8afd013` |

### Still deferred (deliberately, with reason)
- **Dead legacy-campaign code** (`createEventCampaign`/`createPromotionCampaign`/`createWeeklyCampaign` + `weeklyCampaignSchema`/`scheduleModeEnum`/`buildSpreadEvenlyPlans` in `lib/create/service.ts`/`schema.ts`): confirmed no production caller, BUT ~1000 lines with heavy test coverage and a `management-actions` test surface. Removing it at the tail of this session is a large, maintainability-only change that risks the management-app path — belongs in its own reviewed PR. **Recommend a dedicated follow-up.**
- **handler.ts v2 worker vs live schema**: now bypassed in production (FF-001 fix), so harmless. Whether to delete handler.ts/`publish_attempts`/QStash entirely, or migrate the live schema to v2, remains an architectural decision — not forced by any bug now.

### Passes run
2 discovery passes (my live-DB trace + 4-agent sweep). Sibling search surfaced the broad story-no-media gap (M3-broad) and the audit-logging gap across all `content.ts` mutations — both queued above. No new defects after the fixes verified clean.
