---
title: Optimization Opportunities
created: 2026-03-14
last_updated: 2026-03-14
status: current
notes: 1 item resolved (notifications index)
tags:
  - type/reference
  - section/health
related:
  - "[[Tech Debt]]"
---

← [[_Index]] / [[_Health MOC]]

# Optimization Opportunities

Issues found during the initial codebase audit. Severity: CRITICAL / HIGH / MEDIUM / LOW.

---

## MEDIUM — Signed URL Regeneration on Every Planner Load

**Location**: `src/lib/planner/data.ts` — `loadPrimaryMediaPreviewsByContent()`

Signed URLs have a 600-second TTL and are regenerated on every planner load. For users with many content items, this generates a large batch of `createSignedUrls()` calls on every page view.

**Fix**: Cache signed URLs client-side with the expiry time, or use Supabase public bucket policies for media that doesn't need per-user access control.

---

## MEDIUM — Planner Content Limit is 500 Items

**Location**: `src/lib/planner/data.ts:316`

⚠️ PARTIALLY MITIGATED 2026-03-14 — 180-day range cap added to loadPlannerContent; 500-item limit remains for accounts with very dense scheduling. Full fix requires pagination.

The planner query is hard-limited to 500 content items. Heavy users with many scheduled posts over a long date range could hit this silently.

**Fix**: Add pagination or virtualised infinite scroll to the planner calendar. Alternatively, enforce a tighter date range on the client before querying.

---

## MEDIUM — In-Process Google Location Cache

**Location**: `src/lib/connections/token-exchange.ts:16`

The `googleLocationCache` is a `Map` stored in the Node.js process memory with a 5-minute TTL. This cache is per-instance and will not work in serverless/edge deployments where each request may be a fresh process.

**Fix**: Use a distributed cache (Redis via Upstash, or Supabase KV) or accept that the cache is a best-effort warm-up only.

---

## ~~MEDIUM — Missing Indexes on `notifications` and `publish_jobs` for Time-Scoped Queries~~ ✅ RESOLVED 2026-03-14

**Location**: `supabase/migrations/20260314000001_add_notifications_composite_index.sql`

Added a partial composite index for the most common planner query pattern:

```sql
CREATE INDEX IF NOT EXISTS notifications_account_unread_idx
  ON public.notifications (account_id, created_at DESC)
  WHERE read_at IS NULL;
```

This eliminates the full-table scan on the `notifications` table for the `(account_id, read_at IS NULL)` query executed on every planner load.

---

## LOW — `getPlannerOverview` Loads All Three Datasets Regardless of Need

**Location**: `src/lib/planner/data.ts`

✅ NOT APPLICABLE — investigation shows the notifications page already uses the `/api/planner/activity` route directly. The optimization was based on an incorrect assumption at audit time.

The function has `includeItems`, `includeActivity`, `includeTrash` flags but callers typically pass all three. For the notifications page, only activity is needed.

**Fix**: Ensure the notifications page (`/planner/notifications`) uses `getPlannerActivity()` directly rather than `getPlannerOverview()` with all flags.

---

## LOW — `normaliseVariants()` Handles Both Array and Single Object

**Location**: `src/lib/planner/data.ts:171`

✅ ACCEPTABLE — the 5-line helper correctly handles Supabase join ambiguity with no performance cost. Not worth removing.

Supabase can return joins as either an array or a single object depending on the query structure. The `normaliseVariants()` helper handles this inconsistency. This indicates the join type is not fully determined.

**Fix**: Ensure all joins that should return arrays use explicit `.returns<Row[]>()` typing and the query structure returns arrays consistently. Then remove the single-object branch.

---

## LOW — Framer Motion Animations Not Disabled in Tests

**Location**: `CLAUDE.md` notes: "Test animations disabled in unit tests"

No evidence of a test setup file that globally disables Framer Motion animations. This may cause timing issues in component tests.

**Fix**: Add `vi.mock('framer-motion', ...)` in the test setup or use `AnimatePresence` with `mode="wait"` and a test-specific `reducedMotion` flag.
