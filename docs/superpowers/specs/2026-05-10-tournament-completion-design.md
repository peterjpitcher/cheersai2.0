# Tournament Module Completion — Design Spec

**Date:** 2026-05-10
**Status:** Draft — awaiting approval
**Scope:** Close all functional gaps in the tournament management UI
**Builds on:** `2026-05-09-tournament-content-design.md` (original spec)

---

## Problem

The tournament content module has a working backend (generation, scheduling, publishing) but the management UI is incomplete. Users cannot add fixtures, fully edit fixture details, delete fixtures or tournaments, preview generated content, or import fixture data without CLI access. The module is not self-service.

---

## What works today

| Feature | Status |
|---------|--------|
| Create tournament (modal) | Working |
| Tournament list with stats | Working |
| Tournament settings (name, rules, template, images, status) | Working |
| Inline team name editing | Working |
| Toggle fixture showing | Working |
| Save & Generate per fixture | Working |
| Bulk Generate All | Working |
| Publish Now (past-due) | Working |
| Filter/sort fixtures | Working |
| Precondition warnings | Working |
| Overlay image generation (Satori + Sharp) | Working |
| Content scheduling via publish pipeline | Working |

---

## Gap 1: Add Fixture

**Problem:** No way to create fixtures through the UI. The only path is a CLI ops script. New tournaments start empty with no way to populate them.

**Solution:** "Add Fixture" button on the fixture table that opens a modal form.

### Add Fixture Modal fields

| Field | Type | Required | Validation | Default |
|-------|------|----------|------------|---------|
| Match Number | number input | Yes | Positive integer, unique per tournament | Next available number |
| Round | select dropdown | Yes | `group_stage`, `round_of_32`, `round_of_16`, `quarter_final`, `semi_final`, `third_place`, `final` | `group_stage` |
| Group Name | text input | No | Max 20 chars | Empty |
| Team A | text input | Yes | Max 50 chars | Empty |
| Team B | text input | Yes | Max 50 chars | Empty |
| Kick-off Date & Time | datetime-local input | Yes | Must be valid datetime | Empty |
| Venue City | text input | No | Max 100 chars | Empty |
| Showing | checkbox | No | Boolean | `false` |
| Showing Note | text input | No | Max 200 chars | Empty |
| Booking URL | text input | No | Must be `https://` or empty | Empty |

### Server action: `createFixture`

```
createFixture(tournamentId: string, input: CreateFixtureInput)
  → { success: boolean; error?: string; fixtureId?: string }
```

- Validates tournament ownership
- Validates input with Zod schema
- Inserts into `tournament_fixtures`
- Auto-detects `teams_confirmed` using existing placeholder pattern logic
- Revalidates tournament detail page

### UI behaviour

- Button placement: top-right of fixture table, next to sort controls
- After successful creation: modal closes, fixture table refreshes with new row
- Validation errors shown inline in modal

---

## Gap 2: Full Fixture Edit Modal

**Problem:** Only team names are editable inline. Users cannot change kick-off time, round, venue, booking URL, showing note, or any other fixture field after initial creation.

**Solution:** "Edit" button per fixture row that opens a full edit modal with all fixture fields.

### Edit Fixture Modal

Same fields as Add Fixture Modal (Gap 1), pre-populated with current values. Additional fields:

| Field | Type | Notes |
|-------|------|-------|
| Teams Confirmed | checkbox | Manual override for auto-detection |

### Changes to existing `updateFixture` action

The existing `updateFixture` action already accepts all fields via `fixtureUpdateSchema`. No backend changes needed — only a UI modal that sends all fields.

### UI behaviour

- Edit button (pencil icon) in the Actions column of each fixture row
- Modal opens pre-populated with current fixture data
- "Save" button calls existing `updateFixture`
- "Save & Generate" button calls existing `saveAndGenerateFixture`
- Both buttons available in the modal; Generate only enabled when preconditions pass
- On kick-off time change: existing stagger recalculation applies

---

## Gap 3: Delete Fixture

**Problem:** Fixtures cannot be removed. Users can only toggle "showing" off, which hides content but the fixture row remains permanently.

**Solution:** Delete button per fixture with confirmation dialog.

### Server action: `deleteFixture`

```
deleteFixture(tournamentId: string, fixtureId: string)
  → { success: boolean; error?: string }
```

- Validates tournament ownership
- If `content_generated = true`: deletes all associated content items (published and unpublished), media assets, and publish jobs via existing `deleteFixtureContentItems` helper
- Deletes the fixture row (CASCADE handles nothing since content link is via JSONB, not FK)
- Revalidates tournament detail page

### UI behaviour

- Delete button (trash icon) in Actions column, styled as destructive (red on hover)
- Confirmation dialog: "Delete fixture #{matchNumber} ({teamA} vs {teamB})? This will also delete any generated content."
- If fixture has published content, additional warning: "This fixture has published content that will be unlinked."

---

## Gap 4: Delete Tournament

**Problem:** Tournaments are permanent once created. Even the settings modal only offers status changes (draft/active/archived), not deletion.

**Solution:** Delete button in tournament settings modal with confirmation.

### Server action: `deleteTournament`

```
deleteTournament(tournamentId: string)
  → { success: boolean; error?: string }
```

- Validates tournament ownership
- Deletes all fixture content items and media assets first (loop through fixtures, use `deleteFixtureContentItems`)
- Deletes tournament row (CASCADE deletes fixtures via FK)
- Revalidates tournament list page
- Redirects to `/dashboard/tournaments`

### UI behaviour

- "Delete Tournament" button at bottom of settings modal, styled destructive
- Two-step confirmation: "Delete [tournament name]? This will permanently remove all fixtures, generated content, and scheduled posts."
- User must type the tournament name to confirm (prevents accidental deletion)
- Not available while content is actively publishing (check for in-progress publish jobs)

---

## Gap 5: Content Preview

**Problem:** Users cannot see what generated content looks like before or after publishing. They generate and publish blind.

**Solution:** Preview modal that shows the generated overlay image and post caption for a fixture.

### Preview Modal

Triggered by a "Preview" button (eye icon) in the fixture row Actions column. Only visible when `content_generated = true`.

**Modal layout:**

- Two-column layout: square preview (left), story preview (right)
- Below each image: platform badge(s) showing which platforms it targets
- Below images: post caption text (rendered with actual values, not placeholders)
- Scheduled time display: "Scheduled for [date] at [time]"
- Status badge per content item: scheduled / blocked / past_due / published

### Data fetching

Uses existing content item lookup pattern (`prompt_context->>'tournament_fixture_id'`). Fetch content items for the fixture, resolve media asset signed URLs for preview display.

### Server action: `getFixturePreview`

```
getFixturePreview(tournamentId: string, fixtureId: string)
  → { success: boolean; items: PreviewItem[]; error?: string }
```

Where `PreviewItem`:
```
{
  platform: string;
  placement: string;
  status: string;
  scheduledFor: string | null;
  imageUrl: string;         // signed URL
  captionText: string | null;
}
```

---

## Gap 6: Fixture Import

**Problem:** The only way to bulk-add fixtures is a hard-coded CLI script specific to World Cup 2026. Other tournaments (Euros, domestic cups) have no import path.

**Solution:** CSV import form in the tournament detail page.

### CSV format

```csv
match_number,round,group_name,team_a,team_b,kick_off_at,venue_city,showing
1,group_stage,Group A,Mexico,Jamaica,2026-06-11T21:00:00Z,Mexico City,true
2,group_stage,Group A,Colombia,Senegal,2026-06-12T00:00:00Z,Mexico City,false
```

### Import flow

1. User clicks "Import Fixtures" button in tournament header
2. File picker opens (accepts .csv only)
3. Client-side parsing validates column headers and row count
4. Preview table shows parsed data with row-level validation errors highlighted
5. User confirms import
6. Server action inserts rows, skipping duplicates (by match_number)
7. Returns summary: X imported, Y skipped (duplicate), Z errors

### Server action: `importFixtures`

```
importFixtures(tournamentId: string, fixtures: CreateFixtureInput[])
  → { success: boolean; imported: number; skipped: number; errors: ImportError[] }
```

- Validates tournament ownership
- Validates each row with the same Zod schema as `createFixture`
- Upserts on `(tournament_id, match_number)` — existing fixtures are updated, new ones inserted
- Returns per-row error details for display

### UI behaviour

- "Import CSV" button next to "Add Fixture" button
- Max 500 rows per import
- Download template CSV link provided

---

## Implementation priority

| Priority | Gap | Rationale |
|----------|-----|-----------|
| 1 | Add Fixture | Cannot use the module without this |
| 2 | Full Fixture Edit Modal | Users are stuck with seed data values |
| 3 | Delete Fixture | Essential for correcting mistakes |
| 4 | Delete Tournament | Cleanup capability |
| 5 | Content Preview | Quality assurance before publishing |
| 6 | Fixture Import | Efficiency for bulk data; CLI workaround exists |

---

## Files to create or modify

### New files

| File | Purpose |
|------|---------|
| `src/features/tournament/components/AddFixtureModal.tsx` | Add fixture form modal |
| `src/features/tournament/components/FixtureEditModal.tsx` | Full fixture edit modal |
| `src/features/tournament/components/FixturePreviewModal.tsx` | Content preview modal |
| `src/features/tournament/components/ImportFixturesModal.tsx` | CSV import with preview |
| `src/features/tournament/components/DeleteConfirmDialog.tsx` | Reusable confirmation dialog |

### Modified files

| File | Changes |
|------|---------|
| `src/app/actions/tournament.ts` | Add `createFixture`, `deleteFixture`, `deleteTournament`, `getFixturePreview`, `importFixtures` |
| `src/lib/tournament/validation.ts` | Add `fixtureCreateSchema` (similar to `fixtureUpdateSchema` + match_number, round, group_name, venue_city) |
| `src/features/tournament/components/FixtureTable.tsx` | Add "Add Fixture" and "Import CSV" buttons |
| `src/features/tournament/components/FixtureRow.tsx` | Add Edit, Preview, Delete action buttons |
| `src/features/tournament/components/TournamentSettingsModal.tsx` | Add "Delete Tournament" section |
| `src/features/tournament/components/TournamentHeader.tsx` | Pass through additional props for import |

---

## Out of scope

- Drag-and-drop fixture reordering
- Fixture grouping/bracket visualisation
- Auto-fetching fixture data from external APIs
- Multi-tournament content coordination (e.g. "don't post two tournaments at the same time")
- Mobile-specific fixture management layout
