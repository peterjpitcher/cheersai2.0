# Adversarial Review: Tournament Completion Spec + Implementation

**Date:** 2026-05-10
**Mode:** C (Spec Compliance)
**Scope:** `docs/superpowers/specs/2026-05-10-tournament-completion-design.md` + recent implementation changes (create modal, base image picker, sidebar link)
**Pack:** `tasks/codex-qa-review/2026-05-10-tournament-completion-spec-review-pack.md`
**Reviewers:** Assumption Breaker, Spec Trace Auditor, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk (5/5 completed via Codex)

---

## Executive Summary

The spec correctly identifies six functional gaps in the tournament module. However, the code changes submitted alongside the spec only address peripheral polish (create tournament button, base image picker, sidebar link) — none of the six spec gaps (add/edit/delete fixtures, delete tournament, preview, import) are implemented yet. The spec itself is well-structured but has several edge cases and security assumptions that need tightening before implementation begins.

Additionally, the existing implementation code has **three real defects** found by the reviewers that should be fixed regardless of the spec work.

---

## What Appears Solid

- **Tournament creation flow** — `CreateTournamentModal` correctly validates inputs, disables submit while saving, handles errors, and redirects on success (AB, WF confirmed)
- **Media picker account scoping** — `getMediaAssetsForPicker` correctly filters by `account_id`, `media_type = 'image'`, allowed aspect classes, and `hidden_at IS NULL` (all reviewers confirmed)
- **Sidebar active state** — `pathname.startsWith()` correctly highlights nested tournament routes (AB, ARCH confirmed)
- **Spec gap identification** — all six gaps are real and correctly prioritised (Spec Trace confirmed)

---

## Critical Risks

### CR-1: Base image IDs accepted without ownership validation (SEC-001, ARCH-001, AB-006)
**Severity: High | Confidence: Medium | Blocking: Yes**

`updateTournamentBaseImages` writes client-supplied `squareImageId` and `storyImageId` directly to the tournament row after only verifying tournament ownership. No check that the media assets belong to the same account, have the correct aspect class, are not hidden, or are images.

**Risk:** An attacker who knows another account's media asset UUID could attach it to their tournament. If content generation later fetches base images via service-role access, this becomes cross-tenant image exposure.

**Mitigation:** Either add server-side validation queries before the update, or verify that database FK constraints + RLS policies prevent cross-account references. The `tournaments.base_image_square_id` FK references `media_assets(id)` but there's no composite constraint including `account_id`.

**File:** `src/app/actions/tournament.ts:175-204`

---

### CR-2: Status change ignores server errors and closes modal (AB-008, WF-005)
**Severity: Medium | Confidence: High | Blocking: No**

`handleStatusChange` in the settings modal awaits `updateTournamentStatus()` but ignores the returned `{ success, error }` object. The modal always closes, giving false confidence that the status changed.

**Risk:** Auth errors, database failures, or validation errors are silently swallowed. User discovers the failure only after refreshing.

**File:** `src/features/tournament/components/TournamentSettingsModal.tsx:84-92`

---

### CR-3: Settings modal state goes stale on prop changes (AB-007, WF-003)
**Severity: Medium | Confidence: High | Blocking: No**

Modal state (`name`, `postTemplate`, `platforms`, `squareImageId`, `storyImageId`) is initialised from props via `useState()` but never resynchronised when `tournament` prop changes or the modal reopens. If the parent re-renders with updated data (e.g. after a different user saves), the modal shows stale values.

Additionally, if a user makes changes, closes without saving, and reopens, the unsaved edits persist rather than resetting to current values.

**File:** `src/features/tournament/components/TournamentSettingsModal.tsx:19-36`

---

## Implementation Defects

### ID-1: Non-atomic save — settings and images as two separate mutations (ARCH-003, WF-002)
**Severity: Medium | Confidence: High**

`handleSave` calls `updateTournament()` first, then `updateTournamentBaseImages()` separately. If the second call fails, text/platform settings are already committed but the user sees an error, creating a partial save that looks like a full failure.

**File:** `src/features/tournament/components/TournamentSettingsModal.tsx:64-95`

**Fix options:**
1. Merge both updates into a single server action
2. Accept partial saves but show which part succeeded
3. Roll back the first update if the second fails (complex, not recommended)

### ID-2: Asset loading effect has no cancellation or retry (WF-004, SPEC-007)
**Severity: Low | Confidence: Medium**

The `useEffect` that loads media assets calls `.then(setAssets)` without a cleanup/abort guard. Closing the modal during loading can update state on a logically-closed component. The `assetsLoaded` ref prevents retries, so a failed first load permanently shows "no images" with no way to retry.

Additionally, there is no error state — a failed fetch is indistinguishable from an empty library.

**File:** `src/features/tournament/components/TournamentSettingsModal.tsx:49-57`

### ID-3: Read-only server action in mutation file (ARCH-002)
**Severity: Low | Confidence: High**

`getMediaAssetsForPicker` is a read-only data fetch placed in the tournament actions file (which is a `'use server'` mutations module) and called from a `useEffect`. This conflicts with the repo convention that server actions handle mutations while reads go through server component data fetching or React Query.

**File:** `src/app/actions/tournament.ts:507-553`

---

## Spec Defects

### SD-1: Spec does not address base image ownership validation
The spec's Gap 1-6 descriptions don't mention validating base image IDs server-side. The `updateTournamentBaseImages` action (which already exists) needs an ownership check added, but this isn't captured in any gap.

**Recommendation:** Add to spec: "All server actions that accept media asset IDs must validate ownership (account_id match), aspect class, hidden status, and media type before writing."

### SD-2: Spec's `deleteFixture` underspecifies content cleanup
The spec says "deletes all associated content items (published and unpublished), media assets, and publish jobs" but content items are linked via JSONB `prompt_context`, not FK. The existing `deleteFixtureContentItems` helper handles this, but the spec should reference it explicitly and note that in-progress publish jobs need cancellation, not just deletion.

### SD-3: Spec's `deleteTournament` name-confirmation UX is unusual
Requiring users to type the tournament name to confirm deletion adds friction uncommon in this app. The existing settings modal uses simple button-based confirmation for status changes. Consider whether a standard "Are you sure?" dialog with a destructive button is sufficient, reserving name-confirmation for truly catastrophic operations (account deletion, data export).

### SD-4: CSV import spec lacks timezone handling
The import spec shows `kick_off_at` as ISO 8601 with UTC offset (`2026-06-11T21:00:00Z`), but doesn't specify what happens if a user uploads times without timezone info. Should the server assume UTC? Europe/London? Reject ambiguous timestamps?

### SD-5: Spec doesn't address fixture import duplicate strategy fully
The spec says "upserts on `(tournament_id, match_number)`" but doesn't specify whether existing fixtures with `content_generated = true` should have their content cleaned up and regenerated, or whether the import should skip/warn about already-generated fixtures.

### SD-6: Content preview spec doesn't address missing/expired signed URLs
`getFixturePreview` returns signed URLs with a TTL. If the user leaves the preview modal open past expiry, images break. The spec should specify either a refresh mechanism or a generous TTL.

---

## Unproven Assumptions

| Assumption | What would confirm/deny |
|------------|------------------------|
| `tournaments.base_image_square_id` FK to `media_assets` enforces same-account ownership | Check the FK definition — standard FK only validates existence, not account_id match |
| RLS on `media_assets` prevents cross-account base image references during content generation | Check whether generation uses service-role client (which bypasses RLS) |
| The settings modal component is always unmounted between tournaments (stale state is a non-issue) | Check `TournamentHeader` — it renders `TournamentSettingsModal` with `open` prop toggle, keeping it mounted |
| RBAC is not needed for tournament management (any authenticated account member can manage) | Confirm the app's permission model — if roles exist, tournament actions need permission checks |

---

## Recommended Fix Order

1. **CR-1** — Add server-side base image ownership validation (security, quick fix)
2. **CR-2** — Handle status change errors in settings modal (quick fix)
3. **CR-3** — Reset modal state when `open` changes or tournament prop updates (quick fix)
4. **ID-1** — Merge settings + images into one server action or accept partial saves explicitly
5. **SD-1 through SD-6** — Update spec before implementation begins
6. Implement spec gaps 1-6 per corrected spec

---

## Minor Observations

- `CreateTournamentModal` uses a `div` with `role="dialog"` instead of the native `<dialog>` element or a headless UI component — functional but non-standard for the repo
- `slugify()` in the create modal strips non-alphanumeric chars but doesn't handle consecutive hyphens from strings like "World Cup --- 2026" (produces `world-cup----2026`)
- The `Sidebar.tsx` active-state fix (`pathname.startsWith`) could false-match if a future route like `/dashboard/tournaments-archive` were added, though this is unlikely
