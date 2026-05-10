# Claude Hand-Off Brief: Tournament Completion Spec + Implementation

**Generated:** 2026-05-10
**Review mode:** C (Spec Compliance)
**Overall risk:** High

---

## DO NOT REWRITE

These are confirmed sound — preserve them:

- `CreateTournamentModal` input validation, disabled-while-saving, error display, and redirect flow
- `getMediaAssetsForPicker` account scoping: filters by `account_id`, `media_type = 'image'`, allowed aspect classes, and `hidden_at IS NULL`
- Sidebar active state using `pathname.startsWith()` for nested tournament routes
- Tournament list page server-gating via `requireAuthContext()` before loading account-scoped data
- `createTournament` server action assigns `account_id` from server auth context (not client)

---

## SPEC REVISION REQUIRED

- [ ] **SD-1**: Add requirement: "All server actions that accept media asset IDs must validate ownership (`account_id` match), aspect class, hidden status, and media type before writing." Currently not captured in any gap.
- [ ] **SD-2**: Gap 3 (`deleteFixture`) must reference the existing `deleteFixtureContentItems` helper explicitly and specify that in-progress publish jobs need **cancellation**, not just deletion.
- [ ] **SD-3**: Reconsider `deleteTournament` name-confirmation UX — the app uses simple button-based confirmation for status changes. A standard "Are you sure?" dialog with a destructive button may be sufficient. Reserve name-confirmation for truly catastrophic operations.
- [ ] **SD-4**: CSV import spec must specify timezone handling for `kick_off_at` values without timezone info. Define: assume UTC? Europe/London? Reject ambiguous timestamps?
- [ ] **SD-5**: Fixture import must define behaviour when existing fixtures have `content_generated = true` — skip, warn, or clean up and regenerate?
- [ ] **SD-6**: Content preview spec must address signed URL expiry. Specify either a refresh mechanism or a generous TTL for `getFixturePreview` URLs.

---

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **CR-1** (High/Blocking): `src/app/actions/tournament.ts:175-204` — `updateTournamentBaseImages` must validate that each media asset ID belongs to the same `account_id`, has `media_type = 'image'`, correct `aspect_class` (square/story), and `hidden_at IS NULL` before writing. Add server-side lookup queries before the update.

- [ ] **CR-2** (Medium): `src/features/tournament/components/TournamentSettingsModal.tsx:84-92` — `handleStatusChange` ignores the `{ success, error }` return from `updateTournamentStatus()`. Check the return value; if `success` is false, display the error and do NOT close the modal.

- [ ] **CR-3** (Medium): `src/features/tournament/components/TournamentSettingsModal.tsx:19-36` — Modal state (`name`, `postTemplate`, `platforms`, `squareImageId`, `storyImageId`) initialised from props but never resynchronised. Add a `useEffect` that resets all state when `open` transitions to `true` or when `tournament` prop changes.

- [ ] **ID-1** (Medium): `src/features/tournament/components/TournamentSettingsModal.tsx:64-95` — `handleSave` calls `updateTournament()` and `updateTournamentBaseImages()` as two separate mutations. Merge into a single server action that updates both atomically, or show which part succeeded if keeping them separate.

- [ ] **ID-2** (Low): `src/features/tournament/components/TournamentSettingsModal.tsx:49-57` — Asset loading `useEffect` has no cleanup/abort guard and no error state. Add an AbortController cleanup, catch errors into an error state, and reset `assetsLoaded` ref on failure so retry is possible.

- [ ] **ID-3** (Low): `src/app/actions/tournament.ts:507-553` — `getMediaAssetsForPicker` is a read-only fetch in a `'use server'` mutations file, called from `useEffect`. Move to the established media query layer or a dedicated data-fetching path per repo convention.

---

## ASSUMPTIONS TO RESOLVE

- [ ] **FK ownership**: Does the `tournaments.base_image_square_id` FK to `media_assets` enforce same-account ownership? Standard FKs only validate existence, not `account_id` match. **Check:** `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'tournaments'::regclass;`

- [ ] **RLS bypass in generation**: Does content generation fetch base images via service-role client (bypassing RLS)? If yes, cross-account base image references become exploitable. **Check:** grep for `getDb()` or service-role usage in generation code paths.

- [ ] **Modal mount lifecycle**: Is `TournamentSettingsModal` always unmounted between closes, or kept mounted with `open` prop toggled? **Check:** `TournamentHeader` render pattern. If mounted continuously, CR-3 is confirmed blocking.

- [ ] **RBAC requirements**: Does the app have roles where some account members should NOT manage tournaments? If so, all tournament server actions need permission checks beyond `requireAuthContext()`. **Check:** existing role/permission helpers in `src/lib/auth/`.

---

## REPO CONVENTIONS TO PRESERVE

- Server actions return `Promise<{ success?: boolean; error?: string }>`
- Mutations in `src/app/actions/` files; reads via server component data fetching or React Query
- `requireAuthContext()` at top of every server action
- `revalidatePath()` after mutations
- `logAuditEvent()` for create/update/delete operations
- DB columns `snake_case`, TypeScript `camelCase`, wrap with `fromDb<T>()`
- `MEDIA_BUCKET` constant from `src/lib/constants` for storage paths

---

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-1**: Re-review after base image ownership validation is added — verify it covers all edge cases (hidden assets, wrong aspect, wrong media type)
- [ ] **ID-1**: Re-review after save atomicity is addressed — verify partial-save scenario is eliminated or explicitly handled in UI
- [ ] **SEC-002**: After RBAC assumption is resolved — if roles exist, verify permission checks are added to `getMediaAssetsForPicker` and all tournament actions

---

## REVISION PROMPT

```
Fix the 3 critical/medium implementation defects in the tournament settings modal and server actions:

1. In src/app/actions/tournament.ts, updateTournamentBaseImages (around line 175):
   Add server-side validation before the update. For each non-null image ID (squareImageId, storyImageId),
   query media_assets to verify the asset exists, belongs to the same accountId, has media_type = 'image',
   has the correct aspect_class ('square' or 'story'), and hidden_at IS NULL. Return an error if validation fails.

2. In src/features/tournament/components/TournamentSettingsModal.tsx, handleStatusChange (around line 84):
   Check the return value of updateTournamentStatus(). If success is false, set the error state and do NOT
   call onClose(). Only close on success.

3. In src/features/tournament/components/TournamentSettingsModal.tsx, state initialization (around line 19):
   Add a useEffect that watches the `open` prop. When open transitions to true, reset all form state
   (name, postTemplate, platforms, squareImageId, storyImageId) to current tournament prop values.
   Also reset assetsLoaded ref so images reload.

After fixing all three, run: npm run lint && npx tsc --noEmit && npm run build
```
