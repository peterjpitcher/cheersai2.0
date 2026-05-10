# Tournament Module Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 implementation defects found by adversarial review, then implement 6 missing features (add/edit/delete fixture, delete tournament, content preview, CSV import) to make the tournament module fully self-service.

**Architecture:** Server actions in `src/app/actions/tournament.ts` handle all mutations. Client components in `src/features/tournament/components/` provide the UI. Validation schemas in `src/lib/tournament/validation.ts`. Types in `src/types/tournament.ts`. Queries in `src/lib/tournament/queries.ts`.

**Tech Stack:** Next.js 16.1 App Router, React 19, TypeScript strict, Supabase PostgreSQL, Zod validation, Tailwind CSS.

---

## Task 1: Fix Settings Modal Defects (CR-2, CR-3, ID-2)

Three bugs in `TournamentSettingsModal.tsx` identified by adversarial review: status change ignores errors, modal state goes stale on reopen, and asset loading has no cleanup or error handling.

**Files:**
- Modify: `src/features/tournament/components/TournamentSettingsModal.tsx`

- [ ] **Step 1: Fix handleStatusChange to check return value**

In `src/features/tournament/components/TournamentSettingsModal.tsx`, replace the `handleStatusChange` function (lines 98-106):

```typescript
async function handleStatusChange(status: 'draft' | 'active' | 'archived') {
  setSaving(true);
  setError(null);
  try {
    const result = await updateTournamentStatus(tournament.id, status);
    if (!result.success) {
      setError(result.error ?? 'Failed to change status');
      return;
    }
    onClose();
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 2: Add useEffect to reset state when modal opens or tournament changes**

Add a new `useEffect` after the existing keyboard handler effect (after line 48). This resets all form state when the modal opens or when the tournament prop changes:

```typescript
useEffect(() => {
  if (!open) return;
  setName(tournament.name);
  setHouseRulesText(tournament.houseRulesText ?? '');
  setPostTemplate(tournament.postTemplate);
  setPostLeadHours(tournament.postLeadHours);
  setPlatforms(tournament.platforms);
  setSquareImageId(tournament.baseImageSquareId);
  setStoryImageId(tournament.baseImageStoryId);
  setError(null);
  assetsLoaded.current = false;
}, [open, tournament.id]);
```

Remove the `assetsLoaded.current = true` guard from the asset loading effect — it's now handled by the reset above. The asset loading effect becomes:

```typescript
useEffect(() => {
  if (!open || assetsLoaded.current) return;
  assetsLoaded.current = true;
  setAssetsLoading(true);
  let cancelled = false;
  getMediaAssetsForPicker()
    .then((result) => { if (!cancelled) setAssets(result); })
    .catch(() => { if (!cancelled) setAssetsError('Failed to load images'); })
    .finally(() => { if (!cancelled) setAssetsLoading(false); });
  return () => { cancelled = true; };
}, [open]);
```

Add a new state variable for asset errors near the other state declarations:

```typescript
const [assetsError, setAssetsError] = useState<string | null>(null);
```

- [ ] **Step 3: Add error state display in the asset picker UI**

In the assets rendering section, add an error branch between the loading and empty states:

```typescript
{assetsLoading ? (
  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
    <Loader2 className="h-4 w-4 animate-spin" />
    Loading images...
  </div>
) : assetsError ? (
  <div className="flex items-center gap-2 text-sm text-red-600 py-4">
    <ImageIcon className="h-4 w-4" />
    {assetsError}
    <button
      type="button"
      onClick={() => { assetsLoaded.current = false; setAssetsError(null); }}
      className="text-xs underline ml-1"
    >
      Retry
    </button>
  </div>
) : assets.length === 0 ? (
  // ... existing empty state
```

- [ ] **Step 4: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/tournament/components/TournamentSettingsModal.tsx
git commit -m "fix(tournament): handle status errors, reset modal state, add asset error handling"
```

---

## Task 2: Add Base Image Ownership Validation (CR-1)

The `updateTournamentBaseImages` server action accepts client-supplied media asset IDs without verifying they belong to the same account. This is a cross-tenant security risk.

**Files:**
- Modify: `src/app/actions/tournament.ts`

- [ ] **Step 1: Add ownership validation before the update**

In `src/app/actions/tournament.ts`, replace the `updateTournamentBaseImages` function (lines 176-205) with a version that validates each image ID:

```typescript
export async function updateTournamentBaseImages(
  tournamentId: string,
  squareImageId: string | null,
  storyImageId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    // Validate each image belongs to this account with correct properties
    const idsToValidate: Array<{ id: string; expectedAspect: string }> = [];
    if (squareImageId) idsToValidate.push({ id: squareImageId, expectedAspect: 'square' });
    if (storyImageId) idsToValidate.push({ id: storyImageId, expectedAspect: 'story' });

    for (const { id, expectedAspect } of idsToValidate) {
      const { data: asset, error: assetError } = await supabase
        .from('media_assets')
        .select('id, account_id, media_type, aspect_class, hidden_at')
        .eq('id', id)
        .maybeSingle();

      if (assetError || !asset) {
        return { success: false, error: `Image not found: ${id}` };
      }
      if (asset.account_id !== accountId) {
        return { success: false, error: 'Image does not belong to this account' };
      }
      if (asset.media_type !== 'image') {
        return { success: false, error: 'Selected asset is not an image' };
      }
      if (asset.aspect_class !== expectedAspect) {
        return { success: false, error: `Expected ${expectedAspect} image, got ${asset.aspect_class}` };
      }
      if (asset.hidden_at !== null) {
        return { success: false, error: 'Selected image has been hidden' };
      }
    }

    const { error } = await supabase
      .from('tournaments')
      .update({
        base_image_square_id: squareImageId,
        base_image_story_id: storyImageId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/tournament.ts
git commit -m "fix(tournament): validate base image ownership before update (CR-1)"
```

---

## Task 3: Add Fixture Create Schema + Server Action

Users cannot add fixtures through the UI. This task adds the Zod schema and `createFixture` server action.

**Files:**
- Modify: `src/lib/tournament/validation.ts`
- Modify: `src/app/actions/tournament.ts`

- [ ] **Step 1: Add fixtureCreateSchema to validation.ts**

In `src/lib/tournament/validation.ts`, add after the existing `fixtureUpdateSchema` (line 24):

```typescript
export const fixtureCreateSchema = z.object({
  matchNumber: z.number().int().positive(),
  round: z.enum([
    'group_stage',
    'round_of_32',
    'round_of_16',
    'quarter_final',
    'semi_final',
    'third_place',
    'final',
  ]),
  groupName: z.string().max(20).optional().nullable(),
  teamA: z.string().min(1).max(50),
  teamB: z.string().min(1).max(50),
  kickOffAt: z.string().datetime(),
  venueCity: z.string().max(100).optional().nullable(),
  showing: z.boolean().default(false),
  showingNote: z.string().max(200).optional().nullable(),
  bookingUrl: z
    .string()
    .url()
    .startsWith('https://')
    .optional()
    .nullable()
    .or(z.literal('')),
});
```

- [ ] **Step 2: Add createFixture server action**

In `src/app/actions/tournament.ts`, add the import for `fixtureCreateSchema` to the existing imports from validation:

```typescript
import {
  tournamentCreateSchema,
  tournamentUpdateSchema,
  fixtureCreateSchema,
  fixtureUpdateSchema,
  checkTournamentPreconditions,
} from '@/lib/tournament/validation';
```

Then add the `createFixture` action after the `updateTournamentBaseImages` function (after line 205):

```typescript
// ---------------------------------------------------------------------------
// createFixture
// ---------------------------------------------------------------------------

export async function createFixture(
  tournamentId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string; fixtureId?: string }> {
  try {
    const parsed = fixtureCreateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const bookingUrl = parsed.bookingUrl === '' ? null : (parsed.bookingUrl ?? null);
    const teamsConfirmed = areBothTeamsConfirmed(parsed.teamA, parsed.teamB);

    const { data, error } = await supabase
      .from('tournament_fixtures')
      .insert({
        tournament_id: tournamentId,
        match_number: parsed.matchNumber,
        round: parsed.round,
        group_name: parsed.groupName ?? null,
        team_a: parsed.teamA,
        team_b: parsed.teamB,
        teams_confirmed: teamsConfirmed,
        kick_off_at: parsed.kickOffAt,
        venue_city: parsed.venueCity ?? null,
        showing: parsed.showing,
        showing_note: parsed.showingNote ?? null,
        booking_url: bookingUrl,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'A fixture with this match number already exists in this tournament.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

    return { success: true, fixtureId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 3: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tournament/validation.ts src/app/actions/tournament.ts
git commit -m "feat(tournament): add fixtureCreateSchema and createFixture server action"
```

---

## Task 4: Add Fixture Modal Component

Create a shared modal component used for both adding and editing fixtures. All fixture fields from the spec.

**Files:**
- Create: `src/features/tournament/components/FixtureModal.tsx`

- [ ] **Step 1: Create the FixtureModal component**

Create `src/features/tournament/components/FixtureModal.tsx`:

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { TournamentFixture, TournamentRound } from '@/types/tournament';

const ROUNDS: { value: TournamentRound; label: string }[] = [
  { value: 'group_stage', label: 'Group Stage' },
  { value: 'round_of_32', label: 'Round of 32' },
  { value: 'round_of_16', label: 'Round of 16' },
  { value: 'quarter_final', label: 'Quarter Final' },
  { value: 'semi_final', label: 'Semi Final' },
  { value: 'third_place', label: 'Third Place' },
  { value: 'final', label: 'Final' },
];

export interface FixtureFormData {
  matchNumber: number;
  round: TournamentRound;
  groupName: string;
  teamA: string;
  teamB: string;
  kickOffAt: string;
  venueCity: string;
  showing: boolean;
  showingNote: string;
  bookingUrl: string;
  teamsConfirmed: boolean;
}

interface FixtureModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: FixtureFormData) => Promise<{ success: boolean; error?: string }>;
  onSaveAndGenerate?: (data: FixtureFormData) => Promise<{ success: boolean; error?: string }>;
  title: string;
  initial?: Partial<FixtureFormData>;
  nextMatchNumber?: number;
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(local: string): string {
  if (!local) return '';
  return new Date(local).toISOString();
}

export function FixtureModal({
  open,
  onClose,
  onSave,
  onSaveAndGenerate,
  title,
  initial,
  nextMatchNumber = 1,
}: FixtureModalProps) {
  const [matchNumber, setMatchNumber] = useState(initial?.matchNumber ?? nextMatchNumber);
  const [round, setRound] = useState<TournamentRound>(initial?.round ?? 'group_stage');
  const [groupName, setGroupName] = useState(initial?.groupName ?? '');
  const [teamA, setTeamA] = useState(initial?.teamA ?? '');
  const [teamB, setTeamB] = useState(initial?.teamB ?? '');
  const [kickOffAt, setKickOffAt] = useState(initial?.kickOffAt ? toDatetimeLocal(initial.kickOffAt) : '');
  const [venueCity, setVenueCity] = useState(initial?.venueCity ?? '');
  const [showing, setShowing] = useState(initial?.showing ?? false);
  const [showingNote, setShowingNote] = useState(initial?.showingNote ?? '');
  const [bookingUrl, setBookingUrl] = useState(initial?.bookingUrl ?? '');
  const [teamsConfirmed, setTeamsConfirmed] = useState(initial?.teamsConfirmed ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMatchNumber(initial?.matchNumber ?? nextMatchNumber);
    setRound(initial?.round ?? 'group_stage');
    setGroupName(initial?.groupName ?? '');
    setTeamA(initial?.teamA ?? '');
    setTeamB(initial?.teamB ?? '');
    setKickOffAt(initial?.kickOffAt ? toDatetimeLocal(initial.kickOffAt) : '');
    setVenueCity(initial?.venueCity ?? '');
    setShowing(initial?.showing ?? false);
    setShowingNote(initial?.showingNote ?? '');
    setBookingUrl(initial?.bookingUrl ?? '');
    setTeamsConfirmed(initial?.teamsConfirmed ?? false);
    setError(null);
  }, [open, initial, nextMatchNumber]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function buildFormData(): FixtureFormData {
    return {
      matchNumber,
      round,
      groupName,
      teamA,
      teamB,
      kickOffAt: kickOffAt ? fromDatetimeLocal(kickOffAt) : '',
      venueCity,
      showing,
      showingNote,
      bookingUrl,
      teamsConfirmed,
    };
  }

  const isValid = teamA.trim() && teamB.trim() && kickOffAt && matchNumber > 0;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(buildFormData());
      if (!result.success) {
        setError(result.error ?? 'Failed to save');
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndGenerate() {
    if (!onSaveAndGenerate) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onSaveAndGenerate(buildFormData());
      if (!result.success) {
        setError(result.error ?? 'Failed to save and generate');
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Match Number *</label>
              <input
                type="number"
                value={matchNumber}
                onChange={(e) => setMatchNumber(parseInt(e.target.value) || 0)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Round *</label>
              <select
                value={round}
                onChange={(e) => setRound(e.target.value as TournamentRound)}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              >
                {ROUNDS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value.slice(0, 20))}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="e.g. Group A"
              maxLength={20}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Team A *</label>
              <input
                type="text"
                value={teamA}
                onChange={(e) => setTeamA(e.target.value.slice(0, 50))}
                className="w-full rounded-md border px-3 py-2 text-sm"
                maxLength={50}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Team B *</label>
              <input
                type="text"
                value={teamB}
                onChange={(e) => setTeamB(e.target.value.slice(0, 50))}
                className="w-full rounded-md border px-3 py-2 text-sm"
                maxLength={50}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Kick-off Date & Time *</label>
              <input
                type="datetime-local"
                value={kickOffAt}
                onChange={(e) => setKickOffAt(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Venue City</label>
              <input
                type="text"
                value={venueCity}
                onChange={(e) => setVenueCity(e.target.value.slice(0, 100))}
                className="w-full rounded-md border px-3 py-2 text-sm"
                maxLength={100}
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showing}
                onChange={(e) => setShowing(e.target.checked)}
                className="rounded border-gray-300"
              />
              Showing at venue
            </label>
            {initial && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={teamsConfirmed}
                  onChange={(e) => setTeamsConfirmed(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Teams confirmed (override)
              </label>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Showing Note</label>
            <input
              type="text"
              value={showingNote}
              onChange={(e) => setShowingNote(e.target.value.slice(0, 200))}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="e.g. Big screen in the garden"
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Booking URL</label>
            <input
              type="url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="https://..."
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          {onSaveAndGenerate && (
            <button
              onClick={handleSaveAndGenerate}
              disabled={saving || !isValid}
              className="inline-flex items-center gap-2 rounded-md bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save & Generate
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isValid}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/tournament/components/FixtureModal.tsx
git commit -m "feat(tournament): add FixtureModal component for add/edit fixture"
```

---

## Task 5: Wire Add Fixture Button into Fixture Table

Add the "Add Fixture" button to `FixtureTable` and wire it to `FixtureModal` + `createFixture`.

**Files:**
- Modify: `src/features/tournament/components/FixtureTable.tsx`

- [ ] **Step 1: Add Add Fixture button and modal to FixtureTable**

Add imports at the top of `src/features/tournament/components/FixtureTable.tsx`:

```typescript
import { Plus } from 'lucide-react';
import { FixtureModal } from './FixtureModal';
import type { FixtureFormData } from './FixtureModal';
import { createFixture } from '@/app/actions/tournament';
```

Add state inside the `FixtureTable` component, after the existing `sortBy` state:

```typescript
const [addOpen, setAddOpen] = useState(false);

const nextMatchNumber = useMemo(() => {
  if (!fixtures.length) return 1;
  return Math.max(...fixtures.map((f) => f.matchNumber)) + 1;
}, [fixtures]);

async function handleAddFixture(data: FixtureFormData): Promise<{ success: boolean; error?: string }> {
  return createFixture(tournament.id, {
    matchNumber: data.matchNumber,
    round: data.round,
    groupName: data.groupName || null,
    teamA: data.teamA,
    teamB: data.teamB,
    kickOffAt: data.kickOffAt,
    venueCity: data.venueCity || null,
    showing: data.showing,
    showingNote: data.showingNote || null,
    bookingUrl: data.bookingUrl || null,
  });
}
```

Add the button in the filter bar area. Replace the existing `<div>` wrapping filters (lines 71-107) to include the button:

```typescript
<div className="flex items-center gap-2 mb-4 flex-wrap">
  {FILTERS.map((f) => (
    // ... existing filter buttons unchanged
  ))}

  <button
    onClick={() => setAddOpen(true)}
    className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm bg-primary text-primary-foreground hover:bg-primary/90"
  >
    <Plus className="h-3.5 w-3.5" />
    Add Fixture
  </button>

  <div className="ml-auto flex items-center gap-2 text-sm">
    // ... existing sort controls unchanged
  </div>
</div>
```

Add the modal just before the closing `</div>` of the component return:

```typescript
<FixtureModal
  open={addOpen}
  onClose={() => setAddOpen(false)}
  onSave={handleAddFixture}
  title="Add Fixture"
  nextMatchNumber={nextMatchNumber}
/>
```

- [ ] **Step 2: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/tournament/components/FixtureTable.tsx
git commit -m "feat(tournament): wire Add Fixture button to fixture table"
```

---

## Task 6: Add Edit and Delete Buttons to Fixture Rows

Add pencil (edit) and trash (delete) action buttons to each fixture row. Wire edit to `FixtureModal`, add `deleteFixture` server action, and wire delete with confirmation.

**Files:**
- Modify: `src/app/actions/tournament.ts`
- Modify: `src/features/tournament/components/FixtureRow.tsx`

- [ ] **Step 1: Add deleteFixture server action**

In `src/app/actions/tournament.ts`, add the `deleteFixture` action after `createFixture`:

```typescript
// ---------------------------------------------------------------------------
// deleteFixture
// ---------------------------------------------------------------------------

export async function deleteFixture(
  tournamentId: string,
  fixtureId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const fixture = await getFixtureById(supabase, fixtureId, tournamentId);
    if (!fixture) return { success: false, error: 'Fixture not found' };

    if (fixture.contentGenerated) {
      await deleteFixtureContentItems(supabase, fixtureId, accountId);
    }

    const { error } = await supabase
      .from('tournament_fixtures')
      .delete()
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Add edit and delete buttons to FixtureRow**

In `src/features/tournament/components/FixtureRow.tsx`, add imports:

```typescript
import { Loader2, Pencil, Trash2, Eye } from 'lucide-react';
import {
  saveAndGenerateFixture,
  updateFixture,
  toggleFixtureShowing,
  publishNowFixture,
  deleteFixture,
} from '@/app/actions/tournament';
import { FixtureModal } from './FixtureModal';
import type { FixtureFormData } from './FixtureModal';
```

Add state in the component:

```typescript
const [editOpen, setEditOpen] = useState(false);
const [confirmDelete, setConfirmDelete] = useState(false);
```

Add handler functions:

```typescript
async function handleEditSave(data: FixtureFormData): Promise<{ success: boolean; error?: string }> {
  return updateFixture(tournament.id, fixture.id, {
    teamA: data.teamA,
    teamB: data.teamB,
    teamsConfirmed: data.teamsConfirmed,
    showing: data.showing,
    showingNote: data.showingNote || null,
    bookingUrl: data.bookingUrl || null,
    kickOffAt: data.kickOffAt,
  });
}

async function handleEditSaveAndGenerate(data: FixtureFormData): Promise<{ success: boolean; error?: string }> {
  return saveAndGenerateFixture(tournament.id, fixture.id, {
    teamA: data.teamA,
    teamB: data.teamB,
    teamsConfirmed: data.teamsConfirmed,
    showing: data.showing,
    showingNote: data.showingNote || null,
    bookingUrl: data.bookingUrl || null,
    kickOffAt: data.kickOffAt,
  });
}

async function handleDelete() {
  setLoading(true);
  setError(null);
  try {
    const result = await deleteFixture(tournament.id, fixture.id);
    if (!result.success) {
      setError(result.error ?? 'Delete failed');
    }
    setConfirmDelete(false);
  } finally {
    setLoading(false);
  }
}
```

In the actions cell (the last `<td>`), add buttons for edit, delete, and the confirmation inline. Replace the existing actions `<td>` content (lines 182-228):

```typescript
<td className="px-3 py-2 text-right">
  <div className="flex items-center justify-end gap-1">
    {loading && <Loader2 className="h-4 w-4 animate-spin" />}

    {confirmDelete ? (
      <>
        <span className="text-xs text-red-600 mr-1">Delete?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="rounded px-2 py-1 text-xs bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          Yes
        </button>
        <button
          onClick={() => setConfirmDelete(false)}
          className="rounded px-2 py-1 text-xs text-muted-foreground"
        >
          No
        </button>
      </>
    ) : (
      <>
        {editing && isModified && (
          <>
            <button
              onClick={handleSaveOnly}
              disabled={loading}
              className="rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80 disabled:opacity-50"
            >
              Save
            </button>
            {canSaveAndGenerate && (
              <button
                onClick={handleSaveAndGenerate}
                disabled={loading}
                className="rounded px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Save & Generate
              </button>
            )}
          </>
        )}

        {editing && !isModified && (
          <button
            onClick={() => setEditing(false)}
            className="rounded px-2 py-1 text-xs text-muted-foreground"
          >
            Cancel
          </button>
        )}

        {!editing && (
          <>
            <button
              onClick={() => setEditOpen(true)}
              className="rounded p-1 text-muted-foreground hover:text-primary"
              title="Edit fixture"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={loading}
              className="rounded p-1 text-muted-foreground hover:text-red-600"
              title="Delete fixture"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            {contentStatus === 'past_due' && (
              <button
                onClick={handlePublishNow}
                disabled={loading}
                className="rounded px-2 py-1 text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
              >
                Publish Now
              </button>
            )}
          </>
        )}
      </>
    )}

    {error && <span className="text-xs text-red-600 ml-1">{error}</span>}
  </div>

  <FixtureModal
    open={editOpen}
    onClose={() => setEditOpen(false)}
    onSave={handleEditSave}
    onSaveAndGenerate={canGenerate ? handleEditSaveAndGenerate : undefined}
    title={`Edit Fixture #${fixture.matchNumber}`}
    initial={{
      matchNumber: fixture.matchNumber,
      round: fixture.round,
      groupName: fixture.groupName ?? '',
      teamA: fixture.teamA,
      teamB: fixture.teamB,
      kickOffAt: fixture.kickOffAt,
      venueCity: fixture.venueCity ?? '',
      showing: fixture.showing,
      showingNote: fixture.showingNote ?? '',
      bookingUrl: fixture.bookingUrl ?? '',
      teamsConfirmed: fixture.teamsConfirmed,
    }}
  />
</td>
```

- [ ] **Step 3: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/tournament.ts src/features/tournament/components/FixtureRow.tsx
git commit -m "feat(tournament): add edit/delete fixture buttons with modal and confirmation"
```

---

## Task 7: Add Delete Tournament to Settings Modal

Add a "Delete Tournament" section at the bottom of `TournamentSettingsModal` with confirmation dialog.

**Files:**
- Modify: `src/app/actions/tournament.ts`
- Modify: `src/features/tournament/components/TournamentSettingsModal.tsx`

- [ ] **Step 1: Add deleteTournament server action**

In `src/app/actions/tournament.ts`, add after the `deleteFixture` action:

```typescript
// ---------------------------------------------------------------------------
// deleteTournament
// ---------------------------------------------------------------------------

export async function deleteTournament(
  tournamentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    // Check for in-progress publish jobs
    const fixtures = await getFixturesByTournament(supabase, tournamentId);
    for (const fixture of fixtures) {
      if (fixture.contentGenerated) {
        await deleteFixtureContentItems(supabase, fixture.id, accountId);
      }
    }

    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/dashboard/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Add delete section to TournamentSettingsModal**

In `src/features/tournament/components/TournamentSettingsModal.tsx`, add imports:

```typescript
import { useRouter } from 'next/navigation';
import { deleteTournament } from '@/app/actions/tournament';
```

Add state for delete confirmation inside the component:

```typescript
const [deleteConfirm, setDeleteConfirm] = useState('');
const [deleting, setDeleting] = useState(false);
const router = useRouter();
```

Add the reset for delete state in the existing reset useEffect:

```typescript
setDeleteConfirm('');
```

Add the handler:

```typescript
async function handleDeleteTournament() {
  if (deleteConfirm !== tournament.name) return;
  setDeleting(true);
  setError(null);
  try {
    const result = await deleteTournament(tournament.id);
    if (!result.success) {
      setError(result.error ?? 'Failed to delete tournament');
      return;
    }
    router.push('/dashboard/tournaments');
  } finally {
    setDeleting(false);
  }
}
```

Add the delete section UI after the Status section, before the error display div:

```typescript
<div className="border-t pt-4 mt-4">
  <label className="block text-sm font-medium mb-2 text-red-600">Delete Tournament</label>
  <p className="text-xs text-muted-foreground mb-3">
    This will permanently remove all fixtures, generated content, and scheduled posts. Type the tournament name to confirm.
  </p>
  <input
    type="text"
    value={deleteConfirm}
    onChange={(e) => setDeleteConfirm(e.target.value)}
    placeholder={tournament.name}
    className="w-full rounded-md border border-red-200 px-3 py-2 text-sm mb-2"
  />
  <button
    onClick={handleDeleteTournament}
    disabled={deleteConfirm !== tournament.name || deleting || saving}
    className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
  >
    {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
    Delete Tournament
  </button>
</div>
```

- [ ] **Step 3: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/tournament.ts src/features/tournament/components/TournamentSettingsModal.tsx
git commit -m "feat(tournament): add delete tournament with name confirmation"
```

---

## Task 8: Add Content Preview Modal

Preview modal showing generated overlay images and post captions for a fixture.

**Files:**
- Modify: `src/app/actions/tournament.ts`
- Create: `src/features/tournament/components/FixturePreviewModal.tsx`
- Modify: `src/features/tournament/components/FixtureRow.tsx`

- [ ] **Step 1: Add getFixturePreview server action**

In `src/app/actions/tournament.ts`, add after `deleteTournament`:

```typescript
// ---------------------------------------------------------------------------
// getFixturePreview
// ---------------------------------------------------------------------------

export interface PreviewItem {
  platform: string;
  placement: string;
  status: string;
  scheduledFor: string | null;
  imageUrl: string;
  captionText: string | null;
}

export async function getFixturePreview(
  tournamentId: string,
  fixtureId: string,
): Promise<{ success: boolean; items?: PreviewItem[]; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const { data: contentItems, error: fetchError } = await supabase
      .from('content_items')
      .select('id, platform, placement, status, scheduled_for, caption_text, prompt_context')
      .eq('account_id', accountId)
      .contains('prompt_context', { tournament_fixture_id: fixtureId, source: 'tournament' });

    if (fetchError) return { success: false, error: fetchError.message };
    if (!contentItems?.length) return { success: true, items: [] };

    // Get media assets via content_variants
    const itemIds = contentItems.map((i) => i.id as string);
    const { data: variants } = await supabase
      .from('content_variants')
      .select('content_item_id, media_ids')
      .in('content_item_id', itemIds);

    const allMediaIds = new Set<string>();
    const itemMediaMap = new Map<string, string[]>();
    for (const v of variants ?? []) {
      const ids = (v as Record<string, unknown>).media_ids as string[] | null;
      const contentItemId = (v as Record<string, unknown>).content_item_id as string;
      if (ids?.length) {
        itemMediaMap.set(contentItemId, ids);
        ids.forEach((id) => allMediaIds.add(id));
      }
    }

    // Sign URLs for all media assets
    const urlMap = new Map<string, string>();
    if (allMediaIds.size) {
      const { data: assets } = await supabase
        .from('media_assets')
        .select('id, storage_path')
        .in('id', [...allMediaIds]);

      const paths = (assets ?? []).map((a) => (a as Record<string, unknown>).storage_path as string);
      if (paths.length) {
        const { data: signed } = await supabase.storage
          .from(MEDIA_BUCKET)
          .createSignedUrls(paths, 3600);

        if (signed) {
          for (let i = 0; i < (assets ?? []).length; i++) {
            const asset = assets![i];
            const signedEntry = signed.find((s) => s.path === (asset as Record<string, unknown>).storage_path);
            if (signedEntry?.signedUrl && !signedEntry.error) {
              urlMap.set((asset as Record<string, unknown>).id as string, signedEntry.signedUrl);
            }
          }
        }
      }
    }

    const items: PreviewItem[] = contentItems.map((item) => {
      const mediaIds = itemMediaMap.get(item.id as string) ?? [];
      const imageUrl = mediaIds.length ? (urlMap.get(mediaIds[0]) ?? '') : '';

      return {
        platform: item.platform as string,
        placement: item.placement as string,
        status: item.status as string,
        scheduledFor: (item.scheduled_for as string) ?? null,
        imageUrl,
        captionText: (item.caption_text as string) ?? null,
      };
    });

    return { success: true, items };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Create FixturePreviewModal component**

Create `src/features/tournament/components/FixturePreviewModal.tsx`:

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { getFixturePreview } from '@/app/actions/tournament';
import type { PreviewItem } from '@/app/actions/tournament';
import { StatusBadge } from './StatusBadge';

interface FixturePreviewModalProps {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
  fixtureId: string;
  fixtureLabel: string;
}

export function FixturePreviewModal({
  open,
  onClose,
  tournamentId,
  fixtureId,
  fixtureLabel,
}: FixturePreviewModalProps) {
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    let cancelled = false;

    getFixturePreview(tournamentId, fixtureId)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setError(result.error ?? 'Failed to load preview');
          return;
        }
        setItems(result.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load preview');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, tournamentId, fixtureId]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const feedItems = items.filter((i) => i.placement === 'feed');
  const storyItems = items.filter((i) => i.placement === 'story');

  function formatScheduled(iso: string | null): string {
    if (!iso) return 'Not scheduled';
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview: ${fixtureLabel}`}
        tabIndex={-1}
        className="w-full max-w-3xl rounded-lg bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Preview: {fixtureLabel}</h2>
          <button onClick={onClose} aria-label="Close preview">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No generated content for this fixture.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {feedItems.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-3">Feed (Square)</h3>
                {feedItems.map((item, i) => (
                  <div key={i} className="space-y-2 mb-4">
                    {item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrl} alt="Feed preview" className="w-full rounded-lg border" />
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium capitalize">{item.platform}</span>
                      <StatusBadge status={item.status as any} />
                    </div>
                    <p className="text-xs text-muted-foreground">{formatScheduled(item.scheduledFor)}</p>
                    {item.captionText && (
                      <p className="text-sm whitespace-pre-wrap border rounded-md p-2 bg-muted/30">{item.captionText}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {storyItems.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-3">Story</h3>
                {storyItems.map((item, i) => (
                  <div key={i} className="space-y-2 mb-4">
                    {item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrl} alt="Story preview" className="w-full max-w-[200px] rounded-lg border" />
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium capitalize">{item.platform}</span>
                      <StatusBadge status={item.status as any} />
                    </div>
                    <p className="text-xs text-muted-foreground">{formatScheduled(item.scheduledFor)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire preview button into FixtureRow**

In `src/features/tournament/components/FixtureRow.tsx`, add imports:

```typescript
import { FixturePreviewModal } from './FixturePreviewModal';
```

Add state:

```typescript
const [previewOpen, setPreviewOpen] = useState(false);
```

In the non-editing actions section (after the edit/delete buttons, before `{contentStatus === 'past_due'}`), add:

```typescript
{fixture.contentGenerated && (
  <button
    onClick={() => setPreviewOpen(true)}
    className="rounded p-1 text-muted-foreground hover:text-primary"
    title="Preview content"
  >
    <Eye className="h-3.5 w-3.5" />
  </button>
)}
```

Add the modal alongside the existing `FixtureModal` at the end of the `<td>`:

```typescript
<FixturePreviewModal
  open={previewOpen}
  onClose={() => setPreviewOpen(false)}
  tournamentId={tournament.id}
  fixtureId={fixture.id}
  fixtureLabel={`#${fixture.matchNumber} ${fixture.teamA} vs ${fixture.teamB}`}
/>
```

- [ ] **Step 4: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/tournament.ts src/features/tournament/components/FixturePreviewModal.tsx src/features/tournament/components/FixtureRow.tsx
git commit -m "feat(tournament): add content preview modal with signed image URLs"
```

---

## Task 9: Add CSV Fixture Import

Import modal with client-side CSV parsing, preview table, and bulk insert via server action.

**Files:**
- Modify: `src/app/actions/tournament.ts`
- Create: `src/features/tournament/components/ImportFixturesModal.tsx`
- Modify: `src/features/tournament/components/FixtureTable.tsx`

- [ ] **Step 1: Add importFixtures server action**

In `src/app/actions/tournament.ts`, add after `getFixturePreview`:

```typescript
// ---------------------------------------------------------------------------
// importFixtures
// ---------------------------------------------------------------------------

export interface ImportError {
  row: number;
  error: string;
}

export async function importFixtures(
  tournamentId: string,
  fixtures: Array<{
    matchNumber: number;
    round: string;
    groupName: string | null;
    teamA: string;
    teamB: string;
    kickOffAt: string;
    venueCity: string | null;
    showing: boolean;
  }>,
): Promise<{ success: boolean; imported: number; skipped: number; errors: ImportError[] }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: 'Tournament not found' }] };

    if (fixtures.length > 500) {
      return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: 'Maximum 500 fixtures per import' }] };
    }

    let imported = 0;
    let skipped = 0;
    const errors: ImportError[] = [];

    for (let i = 0; i < fixtures.length; i++) {
      const row = fixtures[i];
      try {
        const teamsConfirmed = areBothTeamsConfirmed(row.teamA, row.teamB);

        const { error: upsertError } = await supabase
          .from('tournament_fixtures')
          .upsert(
            {
              tournament_id: tournamentId,
              match_number: row.matchNumber,
              round: row.round,
              group_name: row.groupName,
              team_a: row.teamA,
              team_b: row.teamB,
              teams_confirmed: teamsConfirmed,
              kick_off_at: row.kickOffAt,
              venue_city: row.venueCity,
              showing: row.showing,
            },
            { onConflict: 'tournament_id,match_number' },
          );

        if (upsertError) {
          errors.push({ row: i + 1, error: upsertError.message });
        } else {
          imported++;
        }
      } catch (err) {
        errors.push({ row: i + 1, error: err instanceof Error ? err.message : String(err) });
      }
    }

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

    return { success: true, imported, skipped, errors };
  } catch (err) {
    return { success: false, imported: 0, skipped: 0, errors: [{ row: 0, error: err instanceof Error ? err.message : String(err) }] };
  }
}
```

- [ ] **Step 2: Create ImportFixturesModal component**

Create `src/features/tournament/components/ImportFixturesModal.tsx`:

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Upload, AlertCircle } from 'lucide-react';
import { importFixtures } from '@/app/actions/tournament';

interface ParsedRow {
  matchNumber: number;
  round: string;
  groupName: string | null;
  teamA: string;
  teamB: string;
  kickOffAt: string;
  venueCity: string | null;
  showing: boolean;
  error?: string;
}

interface ImportFixturesModalProps {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
}

const VALID_ROUNDS = [
  'group_stage', 'round_of_32', 'round_of_16',
  'quarter_final', 'semi_final', 'third_place', 'final',
];

function parseCSV(text: string): { rows: ParsedRow[]; headerError?: string } {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { rows: [], headerError: 'CSV must have a header row and at least one data row' };

  const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const required = ['match_number', 'round', 'team_a', 'team_b', 'kick_off_at'];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length) return { rows: [], headerError: `Missing columns: ${missing.join(', ')}` };

  const idx = (name: string): number => header.indexOf(name);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.length < header.length) {
      rows.push({ matchNumber: 0, round: '', groupName: null, teamA: '', teamB: '', kickOffAt: '', venueCity: null, showing: false, error: 'Too few columns' });
      continue;
    }

    const matchNumber = parseInt(cols[idx('match_number')]);
    const round = cols[idx('round')];
    const teamA = cols[idx('team_a')];
    const teamB = cols[idx('team_b')];
    const kickOffAt = cols[idx('kick_off_at')];
    const groupName = idx('group_name') >= 0 ? cols[idx('group_name')] || null : null;
    const venueCity = idx('venue_city') >= 0 ? cols[idx('venue_city')] || null : null;
    const showing = idx('showing') >= 0 ? cols[idx('showing')].toLowerCase() === 'true' : false;

    let error: string | undefined;
    if (isNaN(matchNumber) || matchNumber < 1) error = 'Invalid match number';
    else if (!VALID_ROUNDS.includes(round)) error = `Invalid round: ${round}`;
    else if (!teamA) error = 'Team A is required';
    else if (!teamB) error = 'Team B is required';
    else if (!kickOffAt || isNaN(Date.parse(kickOffAt))) error = 'Invalid kick-off date';

    rows.push({ matchNumber, round, groupName, teamA, teamB, kickOffAt, venueCity, showing, error });
  }

  return { rows };
}

export function ImportFixturesModal({ open, onClose, tournamentId }: ImportFixturesModalProps) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setHeaderError(null);
    setResult(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setHeaderError(parsed.headerError ?? null);
      setRows(parsed.rows);
      setResult(null);
      setError(null);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const valid = rows.filter((r) => !r.error);
    if (!valid.length) return;

    setImporting(true);
    setError(null);
    try {
      const res = await importFixtures(tournamentId, valid);
      if (!res.success) {
        setError(res.errors[0]?.error ?? 'Import failed');
        return;
      }
      setResult({ imported: res.imported, errors: res.errors.length });
      if (res.errors.length === 0) {
        setTimeout(onClose, 1500);
      }
    } finally {
      setImporting(false);
    }
  }

  const validCount = rows.filter((r) => !r.error).length;
  const errorCount = rows.filter((r) => r.error).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Import Fixtures"
        tabIndex={-1}
        className="w-full max-w-4xl rounded-lg bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Import Fixtures from CSV</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Upload a CSV with columns: match_number, round, team_a, team_b, kick_off_at. Optional: group_name, venue_city, showing.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
          </div>

          {headerError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {headerError}
            </div>
          )}

          {rows.length > 0 && !headerError && (
            <>
              <div className="text-sm">
                <span className="font-medium">{validCount}</span> valid, <span className="font-medium text-red-600">{errorCount}</span> errors
              </div>

              <div className="rounded-lg border overflow-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Round</th>
                      <th className="px-2 py-1 text-left">Team A</th>
                      <th className="px-2 py-1 text-left">Team B</th>
                      <th className="px-2 py-1 text-left">Kick-off</th>
                      <th className="px-2 py-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row, i) => (
                      <tr key={i} className={row.error ? 'bg-red-50/50' : ''}>
                        <td className="px-2 py-1">{row.matchNumber}</td>
                        <td className="px-2 py-1">{row.round}</td>
                        <td className="px-2 py-1">{row.teamA}</td>
                        <td className="px-2 py-1">{row.teamB}</td>
                        <td className="px-2 py-1">{row.kickOffAt ? new Date(row.kickOffAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : ''}</td>
                        <td className="px-2 py-1">{row.error ? <span className="text-red-600">{row.error}</span> : <span className="text-green-600">OK</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              Imported {result.imported} fixtures.{result.errors > 0 && ` ${result.errors} rows had errors.`}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importing || validCount === 0 || !!result}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {importing && <Loader2 className="h-4 w-4 animate-spin" />}
            <Upload className="h-4 w-4" />
            Import {validCount} Fixtures
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire import button into FixtureTable**

In `src/features/tournament/components/FixtureTable.tsx`, add imports:

```typescript
import { Plus, Upload } from 'lucide-react';
import { ImportFixturesModal } from './ImportFixturesModal';
```

Add state:

```typescript
const [importOpen, setImportOpen] = useState(false);
```

Add the import button next to the "Add Fixture" button:

```typescript
<button
  onClick={() => setImportOpen(true)}
  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm bg-muted text-muted-foreground hover:bg-muted/80"
>
  <Upload className="h-3.5 w-3.5" />
  Import CSV
</button>
```

Add the modal next to the existing `FixtureModal`:

```typescript
<ImportFixturesModal
  open={importOpen}
  onClose={() => setImportOpen(false)}
  tournamentId={tournament.id}
/>
```

- [ ] **Step 4: Run verification**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both pass with zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/tournament.ts src/features/tournament/components/ImportFixturesModal.tsx src/features/tournament/components/FixtureTable.tsx
git commit -m "feat(tournament): add CSV fixture import with preview and validation"
```

---

## Task 10: Final Verification and Build

Run the complete verification pipeline.

**Files:**
- None (verification only)

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: zero errors, zero warnings.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean compilation.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: successful production build.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 5: Commit any lint/type fixes if needed**

If any verification step fails, fix and commit:

```bash
git add -A
git commit -m "fix(tournament): resolve lint/type issues from completion implementation"
```
