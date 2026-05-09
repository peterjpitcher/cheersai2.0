# Review Pack: proximity-label-week-fix

**Generated:** 2026-05-09
**Mode:** A (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7`
**Base ref:** `HEAD`
**HEAD:** `ce23e71`
**Diff range:** `HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
tasks/banner-orchestration/proximity-week-fix/SPEC.md
```

## User Concerns

We are reviewing a SPEC for a bug fix. No code change exists yet. The buggy code is in src/lib/scheduling/proximity-label.ts and supabase/functions/publish-queue/banner-label.ts (intentional duplicate for Deno). The relevant test file is tests/lib/scheduling/proximity-label.test.ts. These three files are appended below the auto-generated pack — please reason about whether the SPEC's proposed week-aware logic correctly fixes the bug for ALL edge cases (DST, year-end, timezone, weekly campaigns), whether the listed surfaces are complete, and whether anything about the spec is wrong, missing, or risky.

## Spec

Source: `/Users/peterpitcher/Cursor/OJ-CheersAI2.0/.claude/worktrees/loving-antonelli-8797d7/tasks/banner-orchestration/proximity-week-fix/SPEC.md`

```markdown
# Proximity-label "next weekday" fix — discovery + spec

**Date:** 2026-05-09
**Severity:** High — customer-facing wrong dates
**Affects:** All event-type stories and posts where the gap between `scheduled_for` and the event date falls in the 7–13 day band but spans two calendar weeks
**Owner:** TBD

---

## 1. Bug report (reproducible)

A story for **Jessica Lovelock Live at The Anchor** is scheduled to publish Sun 10 May 2026 at 06:00, advertising an event on Sat 23 May 2026. The banner overlay reads **"NEXT SATURDAY"**. Customers will read this on Sunday and assume the event is six days away (Sat 16 May). It is actually thirteen days away. **Customers will turn up on the wrong date.**

Same campaign has 5 stories spanning 13.5d, 11.5d, 6.5d, 5.5d, 1.5d to the event — so the same campaign hits both sides of the boundary.

## 2. Root cause

In `src/lib/scheduling/proximity-label.ts:71-79` and the byte-for-byte duplicate at `supabase/functions/publish-queue/banner-label.ts:177-185`:

```ts
if (daysDiff >= 2 && daysDiff <= 6) return `THIS ${weekday}`;
if (daysDiff >= 7 && daysDiff <= 13) return `NEXT ${weekday}`;  // ← too crude
if (daysDiff >= 14) return `${weekdayShort} ${day} ${month}`;
```

`daysDiff = 13` from a Sunday lands on the Saturday in the **week after next**, but the rule labels it `NEXT SATURDAY`. The label is computed against `scheduled_for` (publish time), not against the viewer's clock — but that does not save us, because the viewer sees the same wrong text whenever they look.

### Why "next" is wrong here

Calendar weeks (Mon–Sun, ISO 8601) for the failing case:

| Week | Range | Contains |
|------|-------|----------|
| Week N | Mon 4 May – Sun 10 May | reference Sunday |
| Week N+1 | Mon 11 May – Sun 17 May | (no relevance) |
| Week N+2 | Mon 18 May – Sun 24 May | event Saturday |

The event Saturday is in **N+2**, not N+1. "Next Saturday" should mean the Saturday in N+1 (i.e. 16 May, six days away), which the same algorithm independently labels `THIS SATURDAY`. Two of our own labels point at the same date — broken.

## 3. Where the bug fires

| Surface | File | Reference time | Notes |
|---------|------|----------------|-------|
| Planner list view | `src/lib/planner/data.ts:623` | `content_items.scheduled_for` | Computes label for preview |
| Planner detail view | `src/lib/planner/data.ts:810` | `content_items.scheduled_for` | Same |
| Composer preview | `src/features/planner/planner-content-composer.tsx:137` | varies | Uses passed-in `refAt` |
| Public link-in-bio | `src/lib/link-in-bio/public.ts:410` | Per-tile | Renders label on public profile |
| Publish-queue worker (renders the banner image) | `supabase/functions/publish-queue/worker.ts:229` (calls `getProximityLabel` from `banner-label.ts`) | `content_items.scheduled_for`, falls back to `now()` | This is the one whose output is **baked into the published image** |

All five surfaces share the same logic. The Deno worker uses a duplicated copy by design (Deno cannot resolve `@/` aliases) — the duplicate has the same bug.

## 4. Database state

Live query against `cheersai2.0` (project `nbkjciurhvkfpcpatbnt`):

- `campaigns.metadata.eventStart` = `"2026-05-23T19:00:00.000Z"` for Jessica
- All 5 Jessica stories have `content_variants.banner_text_override = NULL` → label is fully computed at render
- Zero rows across the whole `content_variants` table have weekday strings ("saturday", "next ", "this ") in `banner_text_override`. **Nothing is cached. Nothing is stale. The DB is innocent.**
- One incidental observation: there are two duplicate Jessica campaigns (`20e79b88…` and `4823713d…`). The newer one is the active set. Not in scope for this fix but worth flagging to the user.

## 5. The fix — calendar-week-aware bucket

Replace the days-diff bucket for 7+ days with a calendar-week-difference test, **keeping the 0–6 day rules unchanged** so existing behaviour for short cross-week gaps (e.g. Fri → Mon = `THIS MONDAY`) is preserved.

### New rule set for `getEventLabel`

```
daysDiff <= 0                                   → TODAY / TONIGHT (unchanged)
daysDiff == 1                                   → TOMORROW / TOMORROW NIGHT (unchanged)
daysDiff in [2..6]                              → THIS [WEEKDAY]   (unchanged — proximity wins over week boundary)
daysDiff >= 7  AND  weekDiff == 1               → NEXT [WEEKDAY]
daysDiff >= 7  AND  weekDiff >= 2               → [WEEKDAY_SHORT] [DAY] [MONTH_SHORT]   (date format)
```

`weekDiff` is computed as `eventDay.startOf("week").diff(refDay.startOf("week"), "weeks").weeks`, where Luxon's `startOf("week")` returns the Monday at 00:00.

### Why this works

| Scenario | daysDiff | weekDiff | Label | Right? |
|----------|---------:|---------:|-------|:------:|
| **The bug:** Sun 10 May → Sat 23 May | 13 | 2 | `SAT 23 MAY` | ✓ |
| Sat 9 May → Sat 16 May (next-week same weekday) | 7 | 1 | `NEXT SATURDAY` | ✓ |
| Wed → next Wed (7 days) | 7 | 1 | `NEXT WEDNESDAY` | ✓ |
| Wed → Sat 10 days out | 10 | 1 | `NEXT SATURDAY` | ✓ |
| Wed → Fri 16 days out | 16 | 2 | `FRI 19 JUN` | ✓ |
| Fri → Mon, 3 days, cross-week | 3 | (n/a, ≤6) | `THIS MONDAY` | ✓ (unchanged) |
| Sun → Mon 8 days out | 8 | 2 | date format | ✓ (because Mon 11 May would have been TOMORROW; the next-after-that Monday is genuinely "Mon 18 May", not "next Monday") |

The fix removes the ambiguity: `NEXT [WEEKDAY]` only ever points at the immediately following calendar week.

### Reference-time policy (unchanged)

`scheduled_for` remains the right reference for label computation. Re-rendering on viewer clock would be a much bigger change and would break the published-image case (the worker bakes the label into a PNG). Out of scope.

## 6. Files to change

1. `src/lib/scheduling/proximity-label.ts` — replace lines 76–87 with week-aware logic; keep the rest.
2. `supabase/functions/publish-queue/banner-label.ts` — same change at lines 182–191. Keep the file in sync (it's an intentional duplicate; Deno can't resolve `@/` aliases). Update the in-file comment that still says "Duplicated in supabase/functions/publish-queue/proximity.ts" — the actual filename is `banner-label.ts`. (Stale comment is at `proximity-label.ts:6`.)
3. `tests/lib/scheduling/proximity-label.test.ts` — add cases:
   - **Bug regression:** Sun 10 May → Sat 23 May = `SAT 23 MAY`
   - Sat 9 May → Sat 23 May (14 days exactly) = `SAT 23 MAY` (unchanged, sanity)
   - Sun → Mon 8 days = `MON 18 MAY` (currently would say `NEXT MONDAY` — verify it changes)
   - Sun → Sat 6 days = `THIS SATURDAY` (sanity, unchanged)
   - Verify `THIS MONDAY` for Fri→Mon (3 days) still works (already a test — must stay green)
4. New test for the Deno worker duplicate (or a stricter cross-file parity check) so the two implementations cannot drift again. **See open question Q3.**

## 7. Test plan

### Unit
- All existing `proximity-label.test.ts` cases stay green. The `Fri→Mon (3 days, cross-week) = THIS MONDAY` case is the load-bearing one — week-aware logic must NOT touch the ≤6 day branch.
- New cases above.

### Integration
- Render the Jessica story in the planner detail view with mocked `scheduled_for = 2026-05-10T06:00Z` and `metadata.eventStart = 2026-05-23T19:00Z`. Assert `bannerLabel === "SAT 23 MAY"`.
- Run the publish-queue worker against the same fixture and assert the label passed to the render endpoint is `SAT 23 MAY`.

### Manual smoke (after deploy)
- Open planner for Jessica → confirm tomorrow's story banner reads `SAT 23 MAY`.
- Open the same story's composer preview → same label.
- Trigger banner re-render (or wait for cron) on the 10 May story → confirm baked PNG shows `SAT 23 MAY`.

## 8. Rollout & risk

- **Reversible:** yes, single-commit code change. No DB migration. No data backfill.
- **Re-rendering published banners:** banners on already-published posts (in the past) won't change because the platforms hold the bytes. Banners for stories not yet published will pick up the new label automatically when the worker next renders. **No action needed for past posts.**
- **Stories already queued for today/tomorrow with the wrong label baked in:** worker renders the PNG just before publishing, not at scheduling. So the fix lands → the worker uses the new logic → correct label is rendered into the image when the job actually runs. Confirmed by reading `worker.ts:226-229`.
- **Risk of regression:** low. The change is local to one branch in one function (duplicated twice). The 0–6 day rules are not touched. Existing test coverage is reasonable; we add explicit cases.

## 9. Out of scope (flagging for the user)

- **Duplicate Jessica campaigns** in the DB (`20e79b88…` active, `4823713d…` orphan). Cleanup is separate.
- **Deduplicating the Node/Deno copies** of the proximity logic. Two paths possible: (a) a build step that emits the Deno copy from the canonical Node module, or (b) leave it duplicated and add a parity test. See Q3.
- **Reference-time policy** (compute against viewer clock vs publish time). Currently publish-time. Changing it is a bigger conversation.
- **Body copy** in posts/stories that mention "next Saturday" — this spec only fixes the **banner overlay** label. If the AI-generated body text has the same problem, that's a separate prompt fix.

## 10. Open questions for the user

I'd like sign-off on three things before I implement:

1. **Date format wording.** When 14+ days out (or weekDiff ≥ 2) we render `SAT 23 MAY`. Are you happy with that, or would you prefer `SAT 23` (no month) / `SATURDAY 23` / `23 MAY` / `MAY 23`? My recommendation: keep `SAT 23 MAY` — the existing format, three test cases assert it, and it's unambiguous in any future month.

2. **Edge case: Sunday → Monday-week (8 days).** Under the new rule this becomes `MON 18 MAY` (date format), not `NEXT MONDAY`. Reasoning: from Sunday, "next Monday" is tomorrow; the Monday after that is week-after-next. My recommendation: keep this behaviour — date format is unambiguous, and `NEXT MONDAY` would clash with the listener saying "you mean tomorrow?". But say the word if you'd rather keep it as `NEXT MONDAY`.

3. **Drift prevention between Node/Deno copies.** Lowest-cost option: add a Vitest case that reads both files, extracts the `getEventLabel` function body, and asserts byte equality (modulo whitespace). Higher-cost: emit the Deno copy from the Node source via a script. My recommendation: parity test — small, no build infra, fails loudly when the next dev edits one and forgets the other. Want me to include it in this fix?

If you have no strong view, my defaults are: keep `SAT 23 MAY`, treat 8-day Sun→Mon as date format, add the parity test.
```

## Diff (`HEAD`)

_(no diff output)_

## Changed File Contents

### `tasks/banner-orchestration/proximity-week-fix/SPEC.md`

```
# Proximity-label "next weekday" fix — discovery + spec

**Date:** 2026-05-09
**Severity:** High — customer-facing wrong dates
**Affects:** All event-type stories and posts where the gap between `scheduled_for` and the event date falls in the 7–13 day band but spans two calendar weeks
**Owner:** TBD

---

## 1. Bug report (reproducible)

A story for **Jessica Lovelock Live at The Anchor** is scheduled to publish Sun 10 May 2026 at 06:00, advertising an event on Sat 23 May 2026. The banner overlay reads **"NEXT SATURDAY"**. Customers will read this on Sunday and assume the event is six days away (Sat 16 May). It is actually thirteen days away. **Customers will turn up on the wrong date.**

Same campaign has 5 stories spanning 13.5d, 11.5d, 6.5d, 5.5d, 1.5d to the event — so the same campaign hits both sides of the boundary.

## 2. Root cause

In `src/lib/scheduling/proximity-label.ts:71-79` and the byte-for-byte duplicate at `supabase/functions/publish-queue/banner-label.ts:177-185`:

```ts
if (daysDiff >= 2 && daysDiff <= 6) return `THIS ${weekday}`;
if (daysDiff >= 7 && daysDiff <= 13) return `NEXT ${weekday}`;  // ← too crude
if (daysDiff >= 14) return `${weekdayShort} ${day} ${month}`;
```

`daysDiff = 13` from a Sunday lands on the Saturday in the **week after next**, but the rule labels it `NEXT SATURDAY`. The label is computed against `scheduled_for` (publish time), not against the viewer's clock — but that does not save us, because the viewer sees the same wrong text whenever they look.

### Why "next" is wrong here

Calendar weeks (Mon–Sun, ISO 8601) for the failing case:

| Week | Range | Contains |
|------|-------|----------|
| Week N | Mon 4 May – Sun 10 May | reference Sunday |
| Week N+1 | Mon 11 May – Sun 17 May | (no relevance) |
| Week N+2 | Mon 18 May – Sun 24 May | event Saturday |

The event Saturday is in **N+2**, not N+1. "Next Saturday" should mean the Saturday in N+1 (i.e. 16 May, six days away), which the same algorithm independently labels `THIS SATURDAY`. Two of our own labels point at the same date — broken.

## 3. Where the bug fires

| Surface | File | Reference time | Notes |
|---------|------|----------------|-------|
| Planner list view | `src/lib/planner/data.ts:623` | `content_items.scheduled_for` | Computes label for preview |
| Planner detail view | `src/lib/planner/data.ts:810` | `content_items.scheduled_for` | Same |
| Composer preview | `src/features/planner/planner-content-composer.tsx:137` | varies | Uses passed-in `refAt` |
| Public link-in-bio | `src/lib/link-in-bio/public.ts:410` | Per-tile | Renders label on public profile |
| Publish-queue worker (renders the banner image) | `supabase/functions/publish-queue/worker.ts:229` (calls `getProximityLabel` from `banner-label.ts`) | `content_items.scheduled_for`, falls back to `now()` | This is the one whose output is **baked into the published image** |

All five surfaces share the same logic. The Deno worker uses a duplicated copy by design (Deno cannot resolve `@/` aliases) — the duplicate has the same bug.

## 4. Database state

Live query against `cheersai2.0` (project `nbkjciurhvkfpcpatbnt`):

- `campaigns.metadata.eventStart` = `"2026-05-23T19:00:00.000Z"` for Jessica
- All 5 Jessica stories have `content_variants.banner_text_override = NULL` → label is fully computed at render
- Zero rows across the whole `content_variants` table have weekday strings ("saturday", "next ", "this ") in `banner_text_override`. **Nothing is cached. Nothing is stale. The DB is innocent.**
- One incidental observation: there are two duplicate Jessica campaigns (`20e79b88…` and `4823713d…`). The newer one is the active set. Not in scope for this fix but worth flagging to the user.

## 5. The fix — calendar-week-aware bucket

Replace the days-diff bucket for 7+ days with a calendar-week-difference test, **keeping the 0–6 day rules unchanged** so existing behaviour for short cross-week gaps (e.g. Fri → Mon = `THIS MONDAY`) is preserved.

### New rule set for `getEventLabel`

```
daysDiff <= 0                                   → TODAY / TONIGHT (unchanged)
daysDiff == 1                                   → TOMORROW / TOMORROW NIGHT (unchanged)
daysDiff in [2..6]                              → THIS [WEEKDAY]   (unchanged — proximity wins over week boundary)
daysDiff >= 7  AND  weekDiff == 1               → NEXT [WEEKDAY]
daysDiff >= 7  AND  weekDiff >= 2               → [WEEKDAY_SHORT] [DAY] [MONTH_SHORT]   (date format)
```

`weekDiff` is computed as `eventDay.startOf("week").diff(refDay.startOf("week"), "weeks").weeks`, where Luxon's `startOf("week")` returns the Monday at 00:00.

### Why this works

| Scenario | daysDiff | weekDiff | Label | Right? |
|----------|---------:|---------:|-------|:------:|
| **The bug:** Sun 10 May → Sat 23 May | 13 | 2 | `SAT 23 MAY` | ✓ |
| Sat 9 May → Sat 16 May (next-week same weekday) | 7 | 1 | `NEXT SATURDAY` | ✓ |
| Wed → next Wed (7 days) | 7 | 1 | `NEXT WEDNESDAY` | ✓ |
| Wed → Sat 10 days out | 10 | 1 | `NEXT SATURDAY` | ✓ |
| Wed → Fri 16 days out | 16 | 2 | `FRI 19 JUN` | ✓ |
| Fri → Mon, 3 days, cross-week | 3 | (n/a, ≤6) | `THIS MONDAY` | ✓ (unchanged) |
| Sun → Mon 8 days out | 8 | 2 | date format | ✓ (because Mon 11 May would have been TOMORROW; the next-after-that Monday is genuinely "Mon 18 May", not "next Monday") |

The fix removes the ambiguity: `NEXT [WEEKDAY]` only ever points at the immediately following calendar week.

### Reference-time policy (unchanged)

`scheduled_for` remains the right reference for label computation. Re-rendering on viewer clock would be a much bigger change and would break the published-image case (the worker bakes the label into a PNG). Out of scope.

## 6. Files to change

1. `src/lib/scheduling/proximity-label.ts` — replace lines 76–87 with week-aware logic; keep the rest.
2. `supabase/functions/publish-queue/banner-label.ts` — same change at lines 182–191. Keep the file in sync (it's an intentional duplicate; Deno can't resolve `@/` aliases). Update the in-file comment that still says "Duplicated in supabase/functions/publish-queue/proximity.ts" — the actual filename is `banner-label.ts`. (Stale comment is at `proximity-label.ts:6`.)
3. `tests/lib/scheduling/proximity-label.test.ts` — add cases:
   - **Bug regression:** Sun 10 May → Sat 23 May = `SAT 23 MAY`
   - Sat 9 May → Sat 23 May (14 days exactly) = `SAT 23 MAY` (unchanged, sanity)
   - Sun → Mon 8 days = `MON 18 MAY` (currently would say `NEXT MONDAY` — verify it changes)
   - Sun → Sat 6 days = `THIS SATURDAY` (sanity, unchanged)
   - Verify `THIS MONDAY` for Fri→Mon (3 days) still works (already a test — must stay green)
4. New test for the Deno worker duplicate (or a stricter cross-file parity check) so the two implementations cannot drift again. **See open question Q3.**

## 7. Test plan

### Unit
- All existing `proximity-label.test.ts` cases stay green. The `Fri→Mon (3 days, cross-week) = THIS MONDAY` case is the load-bearing one — week-aware logic must NOT touch the ≤6 day branch.
- New cases above.

### Integration
- Render the Jessica story in the planner detail view with mocked `scheduled_for = 2026-05-10T06:00Z` and `metadata.eventStart = 2026-05-23T19:00Z`. Assert `bannerLabel === "SAT 23 MAY"`.
- Run the publish-queue worker against the same fixture and assert the label passed to the render endpoint is `SAT 23 MAY`.

### Manual smoke (after deploy)
- Open planner for Jessica → confirm tomorrow's story banner reads `SAT 23 MAY`.
- Open the same story's composer preview → same label.
- Trigger banner re-render (or wait for cron) on the 10 May story → confirm baked PNG shows `SAT 23 MAY`.

## 8. Rollout & risk

- **Reversible:** yes, single-commit code change. No DB migration. No data backfill.
- **Re-rendering published banners:** banners on already-published posts (in the past) won't change because the platforms hold the bytes. Banners for stories not yet published will pick up the new label automatically when the worker next renders. **No action needed for past posts.**
- **Stories already queued for today/tomorrow with the wrong label baked in:** worker renders the PNG just before publishing, not at scheduling. So the fix lands → the worker uses the new logic → correct label is rendered into the image when the job actually runs. Confirmed by reading `worker.ts:226-229`.
- **Risk of regression:** low. The change is local to one branch in one function (duplicated twice). The 0–6 day rules are not touched. Existing test coverage is reasonable; we add explicit cases.

## 9. Out of scope (flagging for the user)

- **Duplicate Jessica campaigns** in the DB (`20e79b88…` active, `4823713d…` orphan). Cleanup is separate.
- **Deduplicating the Node/Deno copies** of the proximity logic. Two paths possible: (a) a build step that emits the Deno copy from the canonical Node module, or (b) leave it duplicated and add a parity test. See Q3.
- **Reference-time policy** (compute against viewer clock vs publish time). Currently publish-time. Changing it is a bigger conversation.
- **Body copy** in posts/stories that mention "next Saturday" — this spec only fixes the **banner overlay** label. If the AI-generated body text has the same problem, that's a separate prompt fix.

## 10. Open questions for the user

I'd like sign-off on three things before I implement:

1. **Date format wording.** When 14+ days out (or weekDiff ≥ 2) we render `SAT 23 MAY`. Are you happy with that, or would you prefer `SAT 23` (no month) / `SATURDAY 23` / `23 MAY` / `MAY 23`? My recommendation: keep `SAT 23 MAY` — the existing format, three test cases assert it, and it's unambiguous in any future month.

2. **Edge case: Sunday → Monday-week (8 days).** Under the new rule this becomes `MON 18 MAY` (date format), not `NEXT MONDAY`. Reasoning: from Sunday, "next Monday" is tomorrow; the Monday after that is week-after-next. My recommendation: keep this behaviour — date format is unambiguous, and `NEXT MONDAY` would clash with the listener saying "you mean tomorrow?". But say the word if you'd rather keep it as `NEXT MONDAY`.

3. **Drift prevention between Node/Deno copies.** Lowest-cost option: add a Vitest case that reads both files, extracts the `getEventLabel` function body, and asserts byte equality (modulo whitespace). Higher-cost: emit the Deno copy from the Node source via a script. My recommendation: parity test — small, no build infra, fails loudly when the next dev edits one and forgets the other. Want me to include it in this fix?

If you have no strong view, my defaults are: keep `SAT 23 MAY`, treat 8-day Sun→Mon as date format, add the parity test.
```

## Related Files (grep hints)

_(no related files found by basename grep)_

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — CheersAI 2.0

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Vitest
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: OpenAI, Resend Email, Framer Motion animations, React Query, Social media APIs (Instagram, Facebook, Google My Business)
- **Size**: ~158 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check (max-warnings=0 in CI)
npm run test             # Vitest run (single pass)
npm run test:watch       # Vitest watch mode
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run ci:verify        # Full CI pipeline: lint + typecheck + test + build
npm run ops:*            # Operational scripts (backfill, link-auth, regenerate derivatives)
```

## Architecture

**Route Structure**: App Router with next.js 16 conventions. Key sections:
- `/auth` — Sign in, sign up, password reset (Supabase JWT + cookies)
- `/dashboard` — Main workspace for authenticated users
- `/api/` — Webhooks and integrations (Instagram, Facebook callbacks)

**Auth**: Supabase Auth with JWT + HTTP-only cookies. Auth context in `src/lib/auth/` provides user state and permissions. All server actions re-verify auth server-side.

**Database**: Supabase PostgreSQL with RLS enabled. Service-role operations for system tasks only (backfills, crons). Client operations use anon-key client.

**Key Integrations**:
- **OpenAI**: `src/lib/` — content generation and AI features
- **Social APIs**: Instagram (webhooks), Facebook (Graph API), Google My Business integrations
- **Resend**: Email notifications and transactional email
- **React Query**: Data fetching with custom hooks in `src/lib/`
- **Framer Motion**: Page transitions and animations

**Data Flow**: Server actions handle mutations (auth, content operations). Client components use React Query for fetching. All responses validated with Zod.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (database, API contracts) |
| `src/lib/auth/` | Authentication, server-side auth helpers, rate limiting |
| `src/lib/publishing/` | Publishing queue and preflight checks |
| `src/lib/scheduling/` | Event conflict detection, scheduling logic |
| `src/lib/planner/` | Data fetching for planner features |
| `src/lib/settings/` | Settings data and user preferences |
| `src/env.ts` | Environment variable validation (Zod) |
| `src/app/api/` | Webhooks (Instagram, Facebook, email) |
| `src/features/` | Feature-specific components and logic |
| `supabase/migrations/` | Database schema migrations |
| `vitest.config.ts` | Vitest configuration |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | OpenAI API key for content generation |
| `RESEND_API_KEY` | Resend email service key |
| `RESEND_FROM` | Email sender address |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `NEXT_PUBLIC_SITE_URL` | App base URL for redirects/links |
| `FACEBOOK_APP_ID` | Facebook app ID (public) |
| `FACEBOOK_APP_SECRET` | Facebook app secret (server-only) |
| `INSTAGRAM_APP_ID` | Instagram app ID (public) |
| `INSTAGRAM_APP_SECRET` | Instagram app secret (server-only) |
| `INSTAGRAM_VERIFY_TOKEN` | Instagram webhook verification token |
| `GOOGLE_MY_BUSINESS_CLIENT_ID` | Google My Business OAuth client ID |
| `GOOGLE_MY_BUSINESS_CLIENT_SECRET` | Google My Business OAuth secret |
| `ALERTS_SECRET` | Internal webhook secret for alerts |
| `CRON_SECRET` | Internal webhook secret for cron jobs |
| `ENABLE_CONNECTION_DIAGNOSTICS` | Enable debug logging for integrations |
| `VERCEL_OIDC_TOKEN` | Vercel deployment OIDC (for Vercel functions) |

## Project-Specific Rules / Gotchas

### Env Validation
- `src/env.ts` uses Zod to validate all environment variables at startup
- Missing required vars will throw at build/start time
- Always add new vars to `src/env.ts` before using in code

### Social Media Integrations
- Instagram, Facebook, Google My Business require OAuth tokens and refresh logic
- Webhook verification tokens must match config exactly
- Rate limits enforced per platform — check `src/lib/auth/rate-limit.ts`

### Publishing Queue
- `src/lib/publishing/preflight.ts` validates posts before scheduling
- `src/lib/publishing/queue.ts` manages async publishing
- Always check preflight results before queuing posts

### Scheduling Logic
- `src/lib/scheduling/conflicts.ts` prevents double-booking
- `src/lib/scheduling/materialise.ts` expands recurring events
- Timezone handling uses Luxon library (see workspace CLAUDE.md)

### Testing with Vitest
- Test files coexist with source: `src/**/*.test.ts(x)`
- Mock external services (OpenAI, Resend, Supabase)
- Use factories for test data, not inline object literals
- Minimum 80% coverage on business logic

### Framer Motion Usage
- Used for page transitions and micro-interactions
- Keep animations performant (prefer transform, opacity)
- Test animations disabled in unit tests

### Supabase RLS
- All queries respect RLS — use service-role only for system operations
- Service-role operations documented with comments: `// admin operation: [reason]`
- Never disable RLS "temporarily"

### Resend Email
- All transactional email goes through Resend
- Email templates should be tested with `RESEND_API_KEY` set
- From address format: `"Name (email@domain)"`

### Operational Scripts
- `ops:backfill-connections` — sync social connections
- `ops:backfill-link-in-bio-url` — update profile links
- `ops:link-auth-user` — link Supabase auth to business profile
- `ops:regenerate-story-derivatives` — rebuild cached story variants
- Run in test environment first, then production with caution

### CI Pipeline
- `npm run ci:verify` runs full suite: lint → typecheck → test → build
- All four steps must pass before merge
- No console warnings allowed in CI

### Next.js 16 Specifics
- Using latest App Router patterns
- Server actions with 'use server' directive
- Streaming responses supported but not heavily used
- Build optimization enabled by default
```

---

_End of pack._

---

## Appended: Buggy Source Files (target of the SPEC)

These three files are the actual code under discussion. Reviewers should reason about the SPEC's proposed fix against the real implementation here, not assume.

### `src/lib/scheduling/proximity-label.ts` (canonical Node copy)

```typescript
// src/lib/scheduling/proximity-label.ts
import { DateTime } from "luxon";
import type { CampaignTiming } from "./campaign-timing";
import { getNextWeeklyOccurrence } from "./campaign-timing";

// Duplicated in supabase/functions/publish-queue/proximity.ts — keep in sync
export type ProximityLabel = string | null;

export interface ProximityLabelInput {
  referenceAt: DateTime;
  campaignTiming: CampaignTiming;
}

const EVENING_THRESHOLD_HOUR = 17;

const WEEKDAY_NAMES = [
  "", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const MONTH_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function isEvening(startTime?: string): boolean {
  if (!startTime) return false;
  const hour = parseInt(startTime.split(":")[0], 10);
  return hour >= EVENING_THRESHOLD_HOUR;
}

function getEventStartTimestamp(
  eventDate: DateTime,
  startTime: string | undefined,
  timezone: string
): DateTime {
  if (!startTime) {
    // No start time — use end of day as the "event start" for post-event comparison
    return eventDate.setZone(timezone).endOf("day");
  }
  const [h, m] = startTime.split(":").map(Number);
  return eventDate.setZone(timezone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function getEventLabel(
  referenceAt: DateTime,
  timing: CampaignTiming
): ProximityLabel {
  const tz = timing.timezone;
  const refDay = referenceAt.setZone(tz).startOf("day");
  const eventDay = timing.startAt.setZone(tz).startOf("day");

  // Post-event check: compare against full timestamp
  const eventTimestamp = getEventStartTimestamp(timing.startAt, timing.startTime, tz);
  if (referenceAt >= eventTimestamp) {
    return null;
  }

  const daysDiff = eventDay.diff(refDay, "days").days;

  if (daysDiff <= 0) {
    // Same day
    return isEvening(timing.startTime) ? "TONIGHT" : "TODAY";
  }

  if (daysDiff === 1) {
    return isEvening(timing.startTime) ? "TOMORROW NIGHT" : "TOMORROW";
  }

  const targetInTz = timing.startAt.setZone(tz);

  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
    return `THIS ${weekdayName}`;
  }

  // 7–13 days → NEXT [WEEKDAY]
  if (daysDiff >= 7 && daysDiff <= 13) {
    const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
    return `NEXT ${weekdayName}`;
  }

  // 14+ days → date format e.g. "FRI 19 JUN"
  if (daysDiff >= 14) {
    const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
    const monthShort = MONTH_SHORT[targetInTz.month - 1];
    return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
  }

  return null;
}

export function getProximityLabel(input: ProximityLabelInput): ProximityLabel {
  const { referenceAt, campaignTiming } = input;

  switch (campaignTiming.campaignType) {
    case "event":
      return getEventLabel(referenceAt, campaignTiming);

    case "weekly": {
      if (!campaignTiming.weeklyDayOfWeek) return null;
      const nextOccurrence = getNextWeeklyOccurrence(
        referenceAt,
        campaignTiming.weeklyDayOfWeek,
        campaignTiming.timezone
      );
      const weeklyTiming: CampaignTiming = {
        ...campaignTiming,
        campaignType: "event",
        startAt: nextOccurrence,
      };
      return getEventLabel(referenceAt, weeklyTiming);
    }

    case "promotion":
      return getPromotionLabel(referenceAt, campaignTiming);

    default:
      return null;
  }
}

function getPromotionLabel(
  referenceAt: DateTime,
  timing: CampaignTiming
): ProximityLabel {
  const tz = timing.timezone;
  const refDay = referenceAt.setZone(tz).startOf("day");
  const startDay = timing.startAt.setZone(tz).startOf("day");

  // End-of-day semantics for endAt
  const endDay = timing.endAt
    ? timing.endAt.setZone(tz).startOf("day")
    : undefined;
  const endEOD = endDay
    ? endDay.endOf("day")
    : undefined;

  // After promotion ended
  if (endEOD && referenceAt > endEOD) {
    return null;
  }

  // During promotion (referenceAt >= startAt)
  if (referenceAt >= timing.startAt.setZone(tz).startOf("day")) {
    if (!endDay) return "ON NOW";

    const daysToEnd = endDay.diff(refDay, "days").days;

    if (daysToEnd <= 0) return "LAST DAY";
    if (daysToEnd === 1) return "ENDS TOMORROW";
    if (daysToEnd >= 2 && daysToEnd <= 6) return `${daysToEnd} DAYS LEFT`;

    const weeksToEnd = Math.floor(daysToEnd / 7);
    return `${weeksToEnd} ${weeksToEnd === 1 ? "WEEK" : "WEEKS"} LEFT`;
  }

  // Before promotion start — use event-style logic against startAt
  const daysDiff = startDay.diff(refDay, "days").days;

  if (daysDiff <= 0) return "TODAY";
  if (daysDiff === 1) return "TOMORROW";
  if (daysDiff >= 2 && daysDiff <= 6) {
    const weekdayName = WEEKDAY_NAMES[startDay.weekday];
    return `THIS ${weekdayName}`;
  }

  return null; // 7+ days before start
}
```

### `supabase/functions/publish-queue/banner-label.ts` (Deno duplicate — must stay in sync)

```typescript
// supabase/functions/publish-queue/banner-label.ts
//
// DUPLICATED from src/lib/scheduling/campaign-timing.ts and
// src/lib/scheduling/proximity-label.ts because Deno cannot resolve the
// `@/...` alias used in Node code. Keep the timing extraction and label
// derivation logic in sync with the canonical sources in src/lib/scheduling/.
// The same intentional-duplication pattern is already used by
// supabase/functions/materialise-weekly/utils.ts.

import { DateTime } from "https://esm.sh/luxon@3.7.2";

const DEFAULT_TZ = "Europe/London";

/**
 * Convert a JS getDay() weekday (0=Sunday..6=Saturday) — the format used by
 * weekly campaign metadata — into a Luxon weekday (1=Monday..7=Sunday).
 * Falls back to 1 (Monday) for non-numeric input. Mirrors
 * src/lib/scheduling/campaign-timing.ts:jsDayToLuxonWeekday — keep in sync.
 */
function jsDayToLuxonWeekday(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    if (n < 0 || n > 6) return 1;
    return n === 0 ? 7 : n;
}

export interface CampaignTiming {
    campaignType: "event" | "promotion" | "weekly";
    startAt: DateTime;
    endAt?: DateTime;
    startTime?: string; // "HH:MM"
    weeklyDayOfWeek?: number; // 1=Mon..7=Sun (Luxon weekday)
    timezone: string;
}

/**
 * Extract canonical timing from a campaign's metadata.
 * Handles both current metadata shapes and legacy eventStart ISO strings.
 */
export function extractCampaignTiming(campaign: {
    campaign_type: string;
    metadata: unknown;
}): CampaignTiming {
    const meta = (campaign.metadata ?? {}) as Record<string, unknown>;
    const tz = DEFAULT_TZ;

    if (campaign.campaign_type === "weekly") {
        // metadata.dayOfWeek is JS getDay() (0=Sun..6=Sat). Translate to
        // Luxon weekday (1=Mon..7=Sun) so getNextWeeklyOccurrence works.
        return {
            campaignType: "weekly",
            startAt: DateTime.now().setZone(tz),
            weeklyDayOfWeek: jsDayToLuxonWeekday(meta.dayOfWeek),
            startTime: typeof meta.time === "string" ? meta.time : undefined,
            timezone: tz,
        };
    }

    let startAt: DateTime;
    if (typeof meta.startDate === "string") {
        startAt = DateTime.fromISO(meta.startDate, { zone: tz });
    } else if (typeof meta.eventStart === "string") {
        startAt = DateTime.fromISO(meta.eventStart, { zone: tz });
    } else {
        startAt = DateTime.now().setZone(tz);
    }

    let startTime: string | undefined;
    if (typeof meta.startTime === "string") {
        startTime = meta.startTime;
    } else if (typeof meta.eventStart === "string") {
        const parsed = DateTime.fromISO(meta.eventStart, { zone: tz });
        if (parsed.isValid) {
            startTime = parsed.toFormat("HH:mm");
        }
    }

    if (campaign.campaign_type === "promotion") {
        const endAt = typeof meta.endDate === "string"
            ? DateTime.fromISO(meta.endDate, { zone: tz })
            : undefined;

        return {
            campaignType: "promotion",
            startAt,
            endAt,
            startTime,
            timezone: tz,
        };
    }

    return {
        campaignType: "event",
        startAt,
        startTime,
        timezone: tz,
    };
}

export function getNextWeeklyOccurrence(
    referenceAt: DateTime,
    dayOfWeek: number,
    timezone: string,
): DateTime {
    const ref = referenceAt.setZone(timezone).startOf("day");
    const currentWeekday = ref.weekday;

    let daysUntil = dayOfWeek - currentWeekday;
    if (daysUntil < 0) {
        daysUntil += 7;
    }

    return ref.plus({ days: daysUntil });
}

export type ProximityLabel = string | null;

export interface ProximityLabelInput {
    referenceAt: DateTime;
    campaignTiming: CampaignTiming;
}

const EVENING_THRESHOLD_HOUR = 17;

const WEEKDAY_NAMES = [
    "", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
];

const MONTH_SHORT = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function isEvening(startTime?: string): boolean {
    if (!startTime) return false;
    const hour = parseInt(startTime.split(":")[0], 10);
    return hour >= EVENING_THRESHOLD_HOUR;
}

function getEventStartTimestamp(
    eventDate: DateTime,
    startTime: string | undefined,
    timezone: string,
): DateTime {
    if (!startTime) {
        return eventDate.setZone(timezone).endOf("day");
    }
    const [h, m] = startTime.split(":").map(Number);
    return eventDate.setZone(timezone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function getEventLabel(
    referenceAt: DateTime,
    timing: CampaignTiming,
): ProximityLabel {
    const tz = timing.timezone;
    const refDay = referenceAt.setZone(tz).startOf("day");
    const eventDay = timing.startAt.setZone(tz).startOf("day");

    const eventTimestamp = getEventStartTimestamp(timing.startAt, timing.startTime, tz);
    if (referenceAt >= eventTimestamp) {
        return null;
    }

    const daysDiff = eventDay.diff(refDay, "days").days;

    if (daysDiff <= 0) {
        return isEvening(timing.startTime) ? "TONIGHT" : "TODAY";
    }

    if (daysDiff === 1) {
        return isEvening(timing.startTime) ? "TOMORROW NIGHT" : "TOMORROW";
    }

    const targetInTz = timing.startAt.setZone(tz);

    if (daysDiff >= 2 && daysDiff <= 6) {
        const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
        return `THIS ${weekdayName}`;
    }

    if (daysDiff >= 7 && daysDiff <= 13) {
        const weekdayName = WEEKDAY_NAMES[targetInTz.weekday];
        return `NEXT ${weekdayName}`;
    }

    if (daysDiff >= 14) {
        const weekdayShort = WEEKDAY_NAMES[targetInTz.weekday].slice(0, 3);
        const monthShort = MONTH_SHORT[targetInTz.month - 1];
        return `${weekdayShort} ${targetInTz.day} ${monthShort}`;
    }

    return null;
}

function getPromotionLabel(
    referenceAt: DateTime,
    timing: CampaignTiming,
): ProximityLabel {
    const tz = timing.timezone;
    const refDay = referenceAt.setZone(tz).startOf("day");
    const startDay = timing.startAt.setZone(tz).startOf("day");

    const endDay = timing.endAt
        ? timing.endAt.setZone(tz).startOf("day")
        : undefined;
    const endEOD = endDay
        ? endDay.endOf("day")
        : undefined;

    if (endEOD && referenceAt > endEOD) {
        return null;
    }

    if (referenceAt >= timing.startAt.setZone(tz).startOf("day")) {
        if (!endDay) return "ON NOW";

        const daysToEnd = endDay.diff(refDay, "days").days;

        if (daysToEnd <= 0) return "LAST DAY";
        if (daysToEnd === 1) return "ENDS TOMORROW";
        if (daysToEnd >= 2 && daysToEnd <= 6) return `${daysToEnd} DAYS LEFT`;

        const weeksToEnd = Math.floor(daysToEnd / 7);
        return `${weeksToEnd} ${weeksToEnd === 1 ? "WEEK" : "WEEKS"} LEFT`;
    }

    const daysDiff = startDay.diff(refDay, "days").days;

    if (daysDiff <= 0) return "TODAY";
    if (daysDiff === 1) return "TOMORROW";
    if (daysDiff >= 2 && daysDiff <= 6) {
        const weekdayName = WEEKDAY_NAMES[startDay.weekday];
        return `THIS ${weekdayName}`;
    }

    return null;
}

export function getProximityLabel(input: ProximityLabelInput): ProximityLabel {
    const { referenceAt, campaignTiming } = input;

    switch (campaignTiming.campaignType) {
        case "event":
            return getEventLabel(referenceAt, campaignTiming);

        case "weekly": {
            if (!campaignTiming.weeklyDayOfWeek) return null;
            const nextOccurrence = getNextWeeklyOccurrence(
                referenceAt,
                campaignTiming.weeklyDayOfWeek,
                campaignTiming.timezone,
            );
            const weeklyTiming: CampaignTiming = {
                ...campaignTiming,
                campaignType: "event",
                startAt: nextOccurrence,
            };
            return getEventLabel(referenceAt, weeklyTiming);
        }

        case "promotion":
            return getPromotionLabel(referenceAt, campaignTiming);

        default:
            return null;
    }
}
```

### `tests/lib/scheduling/proximity-label.test.ts` (existing tests — must continue to pass)

```typescript
// tests/lib/scheduling/proximity-label.test.ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getProximityLabel } from "@/lib/scheduling/proximity-label";
import type { CampaignTiming } from "@/lib/scheduling/campaign-timing";

const TZ = "Europe/London";

function eventTiming(date: string, time?: string): CampaignTiming {
  return {
    campaignType: "event",
    startAt: DateTime.fromISO(date, { zone: TZ }),
    startTime: time,
    timezone: TZ,
  };
}

function ref(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: TZ });
}

describe("getProximityLabel — event campaigns", () => {
  it("should return NEXT {WEEKDAY} for 7 days before event", () => {
    // Extended in Wave 1: 7–13 days now produces NEXT [WEEKDAY] instead of null.
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-08", "19:00"), // Friday +7
    });
    expect(result).toBe("NEXT FRIDAY");
  });

  it("should return THIS {WEEKDAY} for 6 days before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-07", "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return THIS {WEEKDAY} for 2 days before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-05T10:00:00"), // Tuesday
      campaignTiming: eventTiming("2026-05-07", "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return THIS MONDAY for Friday→Monday (3 days, cross-week)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"), // Friday
      campaignTiming: eventTiming("2026-05-11", "19:00"), // Monday
    });
    expect(result).toBe("THIS MONDAY");
  });

  it("should return NEXT SATURDAY for Saturday→Saturday (7 days)", () => {
    // Extended in Wave 1: same-weekday-7-days resolves to NEXT [WEEKDAY], not null.
    const result = getProximityLabel({
      referenceAt: ref("2026-05-02T10:00:00"), // Saturday
      campaignTiming: eventTiming("2026-05-09", "19:00"), // next Saturday
    });
    expect(result).toBe("NEXT SATURDAY");
  });

  it("should return TOMORROW for 1 day before, daytime event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "14:00"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return TOMORROW NIGHT for 1 day before, evening event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBe("TOMORROW NIGHT");
  });

  it("should return TODAY for same day, daytime event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07", "14:00"),
    });
    expect(result).toBe("TODAY");
  });

  it("should return TONIGHT for same day, evening event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBe("TONIGHT");
  });

  it("should return TODAY when no start time specified", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T08:00:00"),
      campaignTiming: eventTiming("2026-05-07"),
    });
    expect(result).toBe("TODAY");
  });

  it("should return TOMORROW when no start time, 1 day before", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"),
      campaignTiming: eventTiming("2026-05-07"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return null for post after event start timestamp", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T20:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBeNull();
  });

  it("should return null for post day after event", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: eventTiming("2026-05-07", "19:00"),
    });
    expect(result).toBeNull();
  });
});

function promoTiming(start: string, end: string): CampaignTiming {
  return {
    campaignType: "promotion",
    startAt: DateTime.fromISO(start, { zone: TZ }),
    endAt: DateTime.fromISO(end, { zone: TZ }),
    timezone: TZ,
  };
}

function weeklyTiming(dayOfWeek: number, time?: string): CampaignTiming {
  return {
    campaignType: "weekly",
    startAt: DateTime.now().setZone(TZ),
    weeklyDayOfWeek: dayOfWeek,
    startTime: time,
    timezone: TZ,
  };
}

describe("getProximityLabel — promotion campaigns", () => {
  it("should return null before start, 7+ days out", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-01T10:00:00"),
      campaignTiming: promoTiming("2026-05-09", "2026-05-20"),
    });
    expect(result).toBeNull();
  });

  it("should return THIS {WEEKDAY} before start, 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-05T10:00:00"), // Tuesday
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"), // starts Friday
    });
    expect(result).toBe("THIS FRIDAY");
  });

  it("should return TOMORROW before start, 1 day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("TOMORROW");
  });

  it("should return WEEKS LEFT on start day when end is 7+ days away", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-06-10"),
    });
    expect(result).toBe("4 WEEKS LEFT");
  });

  it("should return WEEKS LEFT during promotion when end is 7+ days away", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("1 WEEK LEFT");
  });

  it("should floor partial weeks for manager special countdowns", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-09T10:00:00"),
      campaignTiming: promoTiming("2026-05-01", "2026-05-31"),
    });
    expect(result).toBe("3 WEEKS LEFT");
  });

  it("should return DAYS LEFT during, end 2-6 days", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-18T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("2 DAYS LEFT");
  });

  it("should return ENDS TOMORROW during, end 1 day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-19T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("ENDS TOMORROW");
  });

  it("should return LAST DAY on end day", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-20T10:00:00"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBe("LAST DAY");
  });

  it("should return null after end date EOD", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-21T00:00:01"),
      campaignTiming: promoTiming("2026-05-08", "2026-05-20"),
    });
    expect(result).toBeNull();
  });

  it("should keep ON NOW fallback for legacy promotions without an end date", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-10T10:00:00"),
      campaignTiming: {
        campaignType: "promotion",
        startAt: DateTime.fromISO("2026-05-08", { zone: TZ }),
        timezone: TZ,
      },
    });
    expect(result).toBe("ON NOW");
  });
});

describe("getProximityLabel — extended bands", () => {
  it("returns NEXT [WEEKDAY] for a target 7 days out (same weekday)", () => {
    // 2026-06-03 is Wednesday; +7 days is Wednesday 2026-06-10
    const result = getProximityLabel({
      referenceAt: ref("2026-06-03T10:00:00"),
      campaignTiming: eventTiming("2026-06-10", "19:00"),
    });
    expect(result).toBe("NEXT WEDNESDAY");
  });

  it("returns NEXT [WEEKDAY] for a target 10 days out", () => {
    // 2026-06-03 is Wednesday; +10 days is Saturday 2026-06-13
    const result = getProximityLabel({
      referenceAt: ref("2026-06-03T10:00:00"),
      campaignTiming: eventTiming("2026-06-13", "18:00"),
    });
    expect(result).toBe("NEXT SATURDAY");
  });

  it("returns date format for target 14+ days out", () => {
    // 2026-06-03 is Wednesday; +16 days is Friday 2026-06-19
    const result = getProximityLabel({
      referenceAt: ref("2026-06-03T10:00:00"),
      campaignTiming: eventTiming("2026-06-19", "19:00"),
    });
    expect(result).toBe("FRI 19 JUN");
  });

  it("uses NEXT [WEEKDAY] for same-weekday-7-days, not THIS [WEEKDAY]", () => {
    // Wed → next Wed should be NEXT WEDNESDAY, not THIS WEDNESDAY
    const result = getProximityLabel({
      referenceAt: ref("2026-06-03T10:00:00"),
      campaignTiming: eventTiming("2026-06-10", "10:00"),
    });
    expect(result).toBe("NEXT WEDNESDAY");
  });

  it("returns date format for next year", () => {
    // 2026-12-20 → 2027-01-05 is 16 days; 2027-01-05 is Tuesday
    const result = getProximityLabel({
      referenceAt: ref("2026-12-20T10:00:00"),
      campaignTiming: eventTiming("2027-01-05", "19:00"),
    });
    expect(result).toBe("TUE 5 JAN");
  });

  it("still returns null for a target in the past", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-06-10T10:00:00"),
      campaignTiming: eventTiming("2026-06-09", "19:00"),
    });
    expect(result).toBeNull();
  });
});

describe("getProximityLabel — weekly campaigns", () => {
  it("should return THIS {WEEKDAY} for same week occurrence", () => {
    // Monday → Thursday event (dayOfWeek=4)
    const result = getProximityLabel({
      referenceAt: ref("2026-05-04T10:00:00"), // Monday
      campaignTiming: weeklyTiming(4, "19:00"), // Thursday
    });
    expect(result).toBe("THIS THURSDAY");
  });

  it("should return TOMORROW for day before weekly occurrence", () => {
    // Wednesday → Thursday event
    const result = getProximityLabel({
      referenceAt: ref("2026-05-06T10:00:00"), // Wednesday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("TOMORROW NIGHT");
  });

  it("should return TONIGHT on the event day (evening)", () => {
    const result = getProximityLabel({
      referenceAt: ref("2026-05-07T10:00:00"), // Thursday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("TONIGHT");
  });

  it("should look at next week after this week's occurrence", () => {
    // Friday after Thursday event → next Thursday is 6 days away
    const result = getProximityLabel({
      referenceAt: ref("2026-05-08T10:00:00"), // Friday
      campaignTiming: weeklyTiming(4, "19:00"),
    });
    expect(result).toBe("THIS THURSDAY");
  });
});
```

### `src/lib/scheduling/campaign-timing.ts` (CampaignTiming type + getNextWeeklyOccurrence)

```typescript
// src/lib/scheduling/campaign-timing.ts
import { DateTime } from "luxon";

const DEFAULT_TZ = "Europe/London";

/**
 * Convert a JS getDay() weekday (0=Sunday..6=Saturday) — the format used by
 * weekly campaign metadata — into a Luxon weekday (1=Monday..7=Sunday).
 * Falls back to 1 (Monday) for non-numeric input.
 */
function jsDayToLuxonWeekday(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n < 0 || n > 6) return 1;
  // JS: 0=Sun..6=Sat → Luxon: 7=Sun, 1=Mon, ..., 6=Sat
  return n === 0 ? 7 : n;
}

export interface CampaignTiming {
  campaignType: "event" | "promotion" | "weekly";
  startAt: DateTime;
  endAt?: DateTime;
  startTime?: string; // "HH:MM"
  weeklyDayOfWeek?: number; // 1=Mon..7=Sun (Luxon weekday)
  timezone: string;
}

/**
 * Extract canonical timing from a campaign's metadata.
 * Handles both current metadata shapes and legacy eventStart ISO strings.
 */
export function extractCampaignTiming(campaign: {
  campaign_type: string;
  metadata: unknown;
}): CampaignTiming {
  const meta = (campaign.metadata ?? {}) as Record<string, unknown>;
  const tz = DEFAULT_TZ;

  if (campaign.campaign_type === "weekly") {
    // metadata.dayOfWeek is stored in JS getDay() format (0=Sunday..6=Saturday)
    // — see src/lib/create/schema.ts:weeklyCampaignSchema.dayOfWeek and
    // supabase/functions/materialise-weekly/utils.ts:clampDay. We translate
    // to Luxon weekday (1=Monday..7=Sunday) here so getNextWeeklyOccurrence
    // and downstream banner-label code use the correct weekday math.
    return {
      campaignType: "weekly",
      startAt: DateTime.now().setZone(tz), // placeholder — weekly uses dayOfWeek
      weeklyDayOfWeek: jsDayToLuxonWeekday(meta.dayOfWeek),
      startTime: typeof meta.time === "string" ? meta.time : undefined,
      timezone: tz,
    };
  }

  // Parse startAt from metadata
  let startAt: DateTime;
  if (typeof meta.startDate === "string") {
    startAt = DateTime.fromISO(meta.startDate, { zone: tz });
  } else if (typeof meta.eventStart === "string") {
    // Legacy: full ISO timestamp
    startAt = DateTime.fromISO(meta.eventStart, { zone: tz });
  } else {
    startAt = DateTime.now().setZone(tz);
  }

  // Extract startTime from metadata or from parsed ISO
  let startTime: string | undefined;
  if (typeof meta.startTime === "string") {
    startTime = meta.startTime;
  } else if (typeof meta.eventStart === "string") {
    const parsed = DateTime.fromISO(meta.eventStart, { zone: tz });
    if (parsed.isValid) {
      startTime = parsed.toFormat("HH:mm");
    }
  }

  if (campaign.campaign_type === "promotion") {
    const endAt = typeof meta.endDate === "string"
      ? DateTime.fromISO(meta.endDate, { zone: tz })
      : undefined;

    return {
      campaignType: "promotion",
      startAt,
      endAt,
      startTime,
      timezone: tz,
    };
  }

  return {
    campaignType: "event",
    startAt,
    startTime,
    timezone: tz,
  };
}

/**
 * Calculate the next occurrence of a weekly event day relative to referenceAt.
 * If referenceAt is on or before the day this week, returns this week's occurrence.
 * If referenceAt is after the day this week, returns next week's occurrence.
 */
export function getNextWeeklyOccurrence(
  referenceAt: DateTime,
  dayOfWeek: number,
  timezone: string
): DateTime {
  const ref = referenceAt.setZone(timezone).startOf("day");
  const currentWeekday = ref.weekday; // 1=Mon..7=Sun

  let daysUntil = dayOfWeek - currentWeekday;
  if (daysUntil < 0) {
    daysUntil += 7;
  }

  return ref.plus({ days: daysUntil });
}
```

---

_End of appended source files._
