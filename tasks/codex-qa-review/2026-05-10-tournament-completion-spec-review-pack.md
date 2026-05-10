# Review Pack: tournament-completion-spec

**Generated:** 2026-05-10
**Mode:** C (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-CheersAI2.0`
**Base ref:** `main~2`
**HEAD:** `252e696`
**Diff range:** `main~2...HEAD`
**Stats:**  6 files changed, 389 insertions(+), 6 deletions(-)

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

```
src/app/(app)/dashboard/tournaments/page.tsx
src/app/actions/tournament.ts
src/components/layout/Sidebar.tsx
src/features/tournament/components/CreateTournamentButton.tsx
src/features/tournament/components/CreateTournamentModal.tsx
src/features/tournament/components/TournamentSettingsModal.tsx
```

## User Concerns

Be critical about edge cases, missing requirements, data integrity, user workflows that fail in real use, security gaps, and anything the spec doesn't address but should

## Spec

Source: `docs/superpowers/specs/2026-05-10-tournament-completion-design.md`

```markdown
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


[spec truncated at line 200 — original has 291 lines]
```

## Diff (`main~2...HEAD`)

```diff
diff --git a/src/app/(app)/dashboard/tournaments/page.tsx b/src/app/(app)/dashboard/tournaments/page.tsx
index 0caeac9..d948d6b 100644
--- a/src/app/(app)/dashboard/tournaments/page.tsx
+++ b/src/app/(app)/dashboard/tournaments/page.tsx
@@ -1,6 +1,7 @@
 import { requireAuthContext } from '@/lib/auth/server';
 import { getTournamentsByAccount } from '@/lib/tournament/queries';
 import { TournamentList } from '@/features/tournament/components/TournamentList';
+import { CreateTournamentButton } from '@/features/tournament/components/CreateTournamentButton';
 
 export default async function TournamentsPage() {
   const { supabase, accountId } = await requireAuthContext();
@@ -15,6 +16,7 @@ export default async function TournamentsPage() {
             Manage tournament fixtures and automated social content
           </p>
         </div>
+        <CreateTournamentButton />
       </div>
       <TournamentList tournaments={tournaments} />
     </div>
diff --git a/src/app/actions/tournament.ts b/src/app/actions/tournament.ts
index 1515592..77cd718 100644
--- a/src/app/actions/tournament.ts
+++ b/src/app/actions/tournament.ts
@@ -4,6 +4,7 @@ import { revalidatePath } from 'next/cache';
 
 import { requireAuthContext } from '@/lib/auth/server';
 import { createServiceSupabaseClient } from '@/lib/supabase/service';
+import { MEDIA_BUCKET } from '@/lib/constants';
 import {
   tournamentCreateSchema,
   tournamentUpdateSchema,
@@ -500,3 +501,53 @@ export async function toggleFixtureShowing(
     return { success: false, error: err instanceof Error ? err.message : String(err) };
   }
 }
+
+// ---------------------------------------------------------------------------
+// getMediaAssetsForPicker
+// ---------------------------------------------------------------------------
+
+export interface PickerAsset {
+  id: string;
+  fileName: string;
+  aspectClass: 'square' | 'story' | 'landscape';
+  previewUrl: string;
+}
+
+export async function getMediaAssetsForPicker(): Promise<PickerAsset[]> {
+  const { supabase, accountId } = await requireAuthContext();
+
+  const { data, error } = await supabase
+    .from('media_assets')
+    .select('id, file_name, aspect_class, storage_path')
+    .eq('account_id', accountId)
+    .eq('media_type', 'image')
+    .in('aspect_class', ['square', 'story'])
+    .is('hidden_at', null)
+    .order('uploaded_at', { ascending: false })
+    .limit(50);
+
+  if (error || !data?.length) return [];
+
+  const paths = data.map((r) => r.storage_path as string);
+  const { data: signed } = await supabase.storage
+    .from(MEDIA_BUCKET)
+    .createSignedUrls(paths, 600);
+
+  const urlMap = new Map<string, string>();
+  if (signed) {
+    for (const entry of signed) {
+      if (entry?.path && entry.signedUrl && !entry.error) {
+        urlMap.set(entry.path, entry.signedUrl);
+      }
+    }
+  }
+
+  return data
+    .map((row) => ({
+      id: row.id as string,
+      fileName: row.file_name as string,
+      aspectClass: (row.aspect_class ?? 'square') as PickerAsset['aspectClass'],
+      previewUrl: urlMap.get(row.storage_path as string) ?? '',
+    }))
+    .filter((a) => a.previewUrl);
+}
diff --git a/src/components/layout/Sidebar.tsx b/src/components/layout/Sidebar.tsx
index 3300986..84e7a01 100644
--- a/src/components/layout/Sidebar.tsx
+++ b/src/components/layout/Sidebar.tsx
@@ -12,6 +12,7 @@ import {
   Image,
   Share2,
   Star,
+  Trophy,
 } from "lucide-react";
 import Link from "next/link";
 import { usePathname } from "next/navigation";
@@ -24,6 +25,7 @@ import { cn } from "@/lib/utils";
 const NAV_ITEMS = [
   { label: "Planner", href: "/planner", icon: CalendarDays },
   { label: "Create", href: "/create", icon: PlusCircle },
+  { label: "Tournaments", href: "/dashboard/tournaments", icon: Trophy },
   { label: "Library", href: "/library", icon: Image },
   { label: "Campaigns", href: "/campaigns", icon: Megaphone },
   { label: "Reviews", href: "/reviews", icon: Star },
@@ -66,7 +68,7 @@ export function Sidebar() {
 
       <nav className="flex-1 space-y-1 px-3 py-6">
         {NAV_ITEMS.map((item) => {
-          const isActive = pathname === item.href;
+          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
           return (
             <Link
               key={item.href}
diff --git a/src/features/tournament/components/CreateTournamentButton.tsx b/src/features/tournament/components/CreateTournamentButton.tsx
new file mode 100644
index 0000000..bf421db
--- /dev/null
+++ b/src/features/tournament/components/CreateTournamentButton.tsx
@@ -0,0 +1,22 @@
+'use client';
+
+import { useState } from 'react';
+import { Plus } from 'lucide-react';
+import { CreateTournamentModal } from './CreateTournamentModal';
+
+export function CreateTournamentButton() {
+  const [open, setOpen] = useState(false);
+
+  return (
+    <>
+      <button
+        onClick={() => setOpen(true)}
+        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
+      >
+        <Plus className="h-4 w-4" />
+        New Tournament
+      </button>
+      <CreateTournamentModal open={open} onClose={() => setOpen(false)} />
+    </>
+  );
+}
diff --git a/src/features/tournament/components/CreateTournamentModal.tsx b/src/features/tournament/components/CreateTournamentModal.tsx
new file mode 100644
index 0000000..9493eb0
--- /dev/null
+++ b/src/features/tournament/components/CreateTournamentModal.tsx
@@ -0,0 +1,184 @@
+'use client';
+
+import { useState, useEffect, useRef } from 'react';
+import { useRouter } from 'next/navigation';
+import { X, Loader2 } from 'lucide-react';
+import { createTournament } from '@/app/actions/tournament';
+
+interface CreateTournamentModalProps {
+  open: boolean;
+  onClose: () => void;
+}
+
+function slugify(text: string): string {
+  return text
+    .toLowerCase()
+    .replace(/[^a-z0-9]+/g, '-')
+    .replace(/^-|-$/g, '');
+}
+
+export function CreateTournamentModal({ open, onClose }: CreateTournamentModalProps) {
+  const router = useRouter();
+  const dialogRef = useRef<HTMLDivElement>(null);
+  const [name, setName] = useState('');
+  const [slug, setSlug] = useState('');
+  const [slugManual, setSlugManual] = useState(false);
+  const [postTemplate, setPostTemplate] = useState(
+    '⚽ {team_a} vs {team_b}\n📅 {date} at {time}\n\n{house_rules}\n\n{booking_url}',
+  );
+  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'facebook']);
+  const [saving, setSaving] = useState(false);
+  const [error, setError] = useState<string | null>(null);
+
+  useEffect(() => {
+    if (!open) return;
+    function handleKeyDown(e: KeyboardEvent) {
+      if (e.key === 'Escape') onClose();
+    }
+    document.addEventListener('keydown', handleKeyDown);
+    dialogRef.current?.focus();
+    return () => document.removeEventListener('keydown', handleKeyDown);
+  }, [open, onClose]);
+
+  if (!open) return null;
+
+  function handleNameChange(value: string) {
+    setName(value);
+    if (!slugManual) setSlug(slugify(value));
+  }
+
+  function togglePlatform(platform: string) {
+    setPlatforms((prev) =>
+      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
+    );
+  }
+
+  async function handleCreate() {
+    setSaving(true);
+    setError(null);
+    try {
+      const result = await createTournament({
+        name,
+        slug,
+        postTemplate,
+        platforms,
+        postLeadHours: 24,
+      });
+      if (!result.success) {
+        setError(result.error ?? 'Failed to create tournament');
+      } else if (result.tournamentId) {
+        onClose();
+        router.push(`/dashboard/tournaments/${result.tournamentId}`);
+      }
+    } finally {
+      setSaving(false);
+    }
+  }
+
+  const canCreate = name.trim().length > 0 && slug.length > 0 && postTemplate.trim().length > 0 && platforms.length > 0;
+
+  return (
+    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
+      <div
+        ref={dialogRef}
+        role="dialog"
+        aria-modal="true"
+        aria-label="Create Tournament"
+        tabIndex={-1}
+        className="w-full max-w-lg rounded-lg bg-background p-6 shadow-xl"
+        onClick={(e) => e.stopPropagation()}
+      >
+        <div className="flex items-center justify-between mb-6">
+          <h2 className="text-lg font-semibold">New Tournament</h2>
+          <button onClick={onClose} aria-label="Close">
+            <X className="h-5 w-5 text-muted-foreground" />
+          </button>
+        </div>
+
+        <div className="space-y-4">
+          <div>
+            <label className="block text-sm font-medium mb-1">Name</label>
+            <input
+              type="text"
+              value={name}
+              onChange={(e) => handleNameChange(e.target.value)}
+              placeholder="e.g. FIFA World Cup 2026"
+              className="w-full rounded-md border px-3 py-2 text-sm"
+              autoFocus
+            />
+          </div>
+
+          <div>
+            <label className="block text-sm font-medium mb-1">Slug</label>
+            <input
+              type="text"
+              value={slug}
+              onChange={(e) => {
+                setSlug(e.target.value);
+                setSlugManual(true);
+              }}
+              placeholder="world-cup-2026"
+              className="w-full rounded-md border px-3 py-2 text-sm font-mono"
+            />
+            <p className="text-xs text-muted-foreground mt-1">
+              URL-friendly identifier. Auto-generated from name.
+            </p>
+          </div>
+
+          <div>
+            <label className="block text-sm font-medium mb-1">
+              Post Template <span className="text-muted-foreground">({postTemplate.length}/500)</span>
+            </label>
+            <textarea
+              value={postTemplate}
+              onChange={(e) => setPostTemplate(e.target.value.slice(0, 500))}
+              className="w-full rounded-md border px-3 py-2 text-sm h-28 resize-none font-mono"
+              maxLength={500}
+            />
+            <p className="text-xs text-muted-foreground mt-1">
+              Placeholders: {'{team_a}'}, {'{team_b}'}, {'{date}'}, {'{time}'}, {'{group_round}'}, {'{house_rules}'}, {'{booking_url}'}
+            </p>
+          </div>
+
+          <div>
+            <label className="block text-sm font-medium mb-2">Platforms</label>
+            <div className="flex gap-4">
+              {(['instagram', 'facebook'] as const).map((p) => (
+                <label key={p} className="flex items-center gap-2 text-sm">
+                  <input
+                    type="checkbox"
+                    checked={platforms.includes(p)}
+                    onChange={() => togglePlatform(p)}
+                    className="rounded border-gray-300"
+                  />
+                  {p.charAt(0).toUpperCase() + p.slice(1)}
+                </label>
+              ))}
+            </div>
+          </div>
+        </div>
+
+        {error && (
+          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
+        )}
+
+        <div className="mt-6 flex justify-end gap-3">
+          <button
+            onClick={onClose}
+            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
+          >
+            Cancel
+          </button>
+          <button
+            onClick={handleCreate}
+            disabled={saving || !canCreate}
+            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
+          >
+            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
+            Create Tournament
+          </button>
+        </div>
+      </div>
+    </div>
+  );
+}
diff --git a/src/features/tournament/components/TournamentSettingsModal.tsx b/src/features/tournament/components/TournamentSettingsModal.tsx
index 978a50d..f009770 100644
--- a/src/features/tournament/components/TournamentSettingsModal.tsx
+++ b/src/features/tournament/components/TournamentSettingsModal.tsx
@@ -1,9 +1,15 @@
 'use client';
 
 import { useState, useEffect, useRef } from 'react';
-import { X, Loader2 } from 'lucide-react';
+import { X, Loader2, ImageIcon, Check } from 'lucide-react';
 import type { Tournament } from '@/types/tournament';
-import { updateTournament, updateTournamentStatus } from '@/app/actions/tournament';
+import {
+  updateTournament,
+  updateTournamentStatus,
+  updateTournamentBaseImages,
+  getMediaAssetsForPicker,
+} from '@/app/actions/tournament';
+import type { PickerAsset } from '@/app/actions/tournament';
 
 interface TournamentSettingsModalProps {
   tournament: Tournament;
@@ -25,6 +31,12 @@ export function TournamentSettingsModal({
   const [error, setError] = useState<string | null>(null);
   const dialogRef = useRef<HTMLDivElement>(null);
 
+  const [squareImageId, setSquareImageId] = useState(tournament.baseImageSquareId);
+  const [storyImageId, setStoryImageId] = useState(tournament.baseImageStoryId);
+  const [assets, setAssets] = useState<PickerAsset[]>([]);
+  const [assetsLoading, setAssetsLoading] = useState(false);
+  const assetsLoaded = useRef(false);
+
   useEffect(() => {
     if (!open) return;
     function handleKeyDown(e: KeyboardEvent) {
@@ -35,6 +47,15 @@ export function TournamentSettingsModal({
     return () => document.removeEventListener('keydown', handleKeyDown);
   }, [open, onClose]);
 
+  useEffect(() => {
+    if (!open || assetsLoaded.current) return;
+    assetsLoaded.current = true;
+    setAssetsLoading(true);
+    getMediaAssetsForPicker()
+      .then(setAssets)
+      .finally(() => setAssetsLoading(false));
+  }, [open]);
+
   if (!open) return null;
 
   async function handleSave() {
@@ -50,9 +71,25 @@ export function TournamentSettingsModal({
       });
       if (!result.success) {
         setError(result.error ?? 'Failed to save');
-      } else {
-        onClose();
+        return;
       }
+
+      const imagesChanged =
+        squareImageId !== tournament.baseImageSquareId ||
+        storyImageId !== tournament.baseImageStoryId;
+      if (imagesChanged) {
+        const imgResult = await updateTournamentBaseImages(
+          tournament.id,
+          squareImageId,
+          storyImageId,
+        );
+        if (!imgResult.success) {
+          setError(imgResult.error ?? 'Failed to save base images');
+          return;
+        }
+      }
+
+      onClose();
     } finally {
       setSaving(false);
     }
@@ -84,7 +121,7 @@ export function TournamentSettingsModal({
         aria-modal="true"
         aria-label="Tournament Settings"
         tabIndex={-1}
-        className="w-full max-w-lg rounded-lg bg-background p-6 shadow-xl"
+        className="w-full max-w-lg rounded-lg bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto"
         onClick={(e) => e.stopPropagation()}
       >
         <div className="flex items-center justify-between mb-6">
@@ -166,6 +203,91 @@ export function TournamentSettingsModal({
             </div>
           </div>
 
+          <div>
+            <label className="block text-sm font-medium mb-2">Base Images</label>
+            <p className="text-xs text-muted-foreground mb-3">
+              Select a square (1:1) and story (9:16) image used as the background for generated fixture posts.
+            </p>
+            {assetsLoading ? (
+              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
+                <Loader2 className="h-4 w-4 animate-spin" />
+                Loading images...
+              </div>
+            ) : assets.length === 0 ? (
+              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
+                <ImageIcon className="h-4 w-4" />
+                No images in library. Upload images in the Library first.
+              </div>
+            ) : (
+              <div className="space-y-3">
+                <div>
+                  <span className="text-xs font-medium text-muted-foreground">Square (1:1)</span>
+                  <div className="flex gap-2 mt-1 overflow-x-auto pb-1">
+                    {assets
+                      .filter((a) => a.aspectClass === 'square')
+                      .map((asset) => (
+                        <button
+                          key={asset.id}
+                          type="button"
+                          onClick={() => setSquareImageId(asset.id)}
+                          className={`relative flex-shrink-0 h-16 w-16 rounded-md overflow-hidden border-2 transition-colors ${
+                            squareImageId === asset.id
+                              ? 'border-primary'
+                              : 'border-transparent hover:border-muted-foreground/30'
+                          }`}
+                          title={asset.fileName}
+                        >
+                          {/* eslint-disable-next-line @next/next/no-img-element */}
+                          <img
+                            src={asset.previewUrl}
+                            alt={asset.fileName}
+                            className="h-full w-full object-cover"
+                          />
+                          {squareImageId === asset.id && (
+                            <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
+                              <Check className="h-5 w-5 text-primary" />
+                            </div>
+                          )}
+                        </button>
+                      ))}
+                  </div>
+                </div>
+                <div>
+                  <span className="text-xs font-medium text-muted-foreground">Story (9:16)</span>
+                  <div className="flex gap-2 mt-1 overflow-x-auto pb-1">
+                    {assets
+                      .filter((a) => a.aspectClass === 'story')
+                      .map((asset) => (
+                        <button
+                          key={asset.id}
+                          type="button"
+                          onClick={() => setStoryImageId(asset.id)}
+                          className={`relative flex-shrink-0 h-20 w-12 rounded-md overflow-hidden border-2 transition-colors ${
+                            storyImageId === asset.id
+                              ? 'border-primary'
+                              : 'border-transparent hover:border-muted-foreground/30'
+                          }`}
+                          title={asset.fileName}
+                        >
+                          {/* eslint-disable-next-line @next/next/no-img-element */}
+                          <img
+                            src={asset.previewUrl}
+                            alt={asset.fileName}
+                            className="h-full w-full object-cover"
+                          />
+                          {storyImageId === asset.id && (
+                            <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
+                              <Check className="h-5 w-5 text-primary" />
+                            </div>
+                          )}
+                        </button>
+                      ))}
+                  </div>
+                </div>
+              </div>
+            )}
+          </div>
+
           <div>
             <label className="block text-sm font-medium mb-2">Status</label>
             <div className="flex gap-2">
```

## Changed File Contents

### `src/app/(app)/dashboard/tournaments/page.tsx`

```
import { requireAuthContext } from '@/lib/auth/server';
import { getTournamentsByAccount } from '@/lib/tournament/queries';
import { TournamentList } from '@/features/tournament/components/TournamentList';
import { CreateTournamentButton } from '@/features/tournament/components/CreateTournamentButton';

export default async function TournamentsPage() {
  const { supabase, accountId } = await requireAuthContext();
  const tournaments = await getTournamentsByAccount(supabase, accountId);

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Tournaments</h1>
          <p className="text-muted-foreground mt-1">
            Manage tournament fixtures and automated social content
          </p>
        </div>
        <CreateTournamentButton />
      </div>
      <TournamentList tournaments={tournaments} />
    </div>
  );
}
```

### `src/app/actions/tournament.ts`

```
'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { MEDIA_BUCKET } from '@/lib/constants';
import {
  tournamentCreateSchema,
  tournamentUpdateSchema,
  fixtureUpdateSchema,
  checkTournamentPreconditions,
} from '@/lib/tournament/validation';
import {
  getTournamentById,
  getFixtureById,
  getFixturesByTournament,
} from '@/lib/tournament/queries';
import {
  generateFixtureContent,
  bulkGenerateContent,
  deleteFixtureContentItems,
} from '@/lib/tournament/generate';
import { areBothTeamsConfirmed } from '@/lib/tournament/placeholder';
import { enqueuePublishJob } from '@/lib/publishing/queue';
import type { Tournament } from '@/types/tournament';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function buildConnectionsMap(
  accountId: string,
  platforms: string[],
): Promise<Record<string, boolean>> {
  const supabase = createServiceSupabaseClient();
  const connections: Record<string, boolean> = {};
  for (const platform of platforms) {
    const { data: conn } = await supabase
      .from('social_connections')
      .select('id')
      .eq('account_id', accountId)
      .eq('provider', platform)
      .limit(1);
    connections[platform] = (conn?.length ?? 0) > 0;
  }
  return connections;
}

// ---------------------------------------------------------------------------
// createTournament
// ---------------------------------------------------------------------------

export async function createTournament(
  input: unknown,
): Promise<{ success: boolean; error?: string; tournamentId?: string }> {
  try {
    const parsed = tournamentCreateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        account_id: accountId,
        name: parsed.name,
        slug: parsed.slug,
        post_template: parsed.postTemplate,
        house_rules_text: parsed.houseRulesText ?? null,
        platforms: parsed.platforms,
        post_lead_hours: parsed.postLeadHours,
        status: 'draft',
        updated_at: nowIso,
      })
      .select('id')
      .single();

    if (error) {
      // Unique constraint violation — duplicate slug for this account
      if (error.code === '23505') {
        return { success: false, error: 'A tournament with this slug already exists.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath('/dashboard/tournaments');

    return { success: true, tournamentId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournament
// ---------------------------------------------------------------------------

export async function updateTournament(
  tournamentId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = tournamentUpdateSchema.parse(input);
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.slug !== undefined) updates.slug = parsed.slug;
    if (parsed.postTemplate !== undefined) updates.post_template = parsed.postTemplate;
    if (parsed.houseRulesText !== undefined) updates.house_rules_text = parsed.houseRulesText;
    if (parsed.platforms !== undefined) updates.platforms = parsed.platforms;
    if (parsed.postLeadHours !== undefined) updates.post_lead_hours = parsed.postLeadHours;

    const { error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'A tournament with this slug already exists.' };
      }
      return { success: false, error: error.message };
    }

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    revalidatePath('/dashboard/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournamentStatus
// ---------------------------------------------------------------------------

export async function updateTournamentStatus(
  tournamentId: string,
  status: Tournament['status'],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const { error } = await supabase
      .from('tournaments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    revalidatePath('/dashboard/tournaments');

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateTournamentBaseImages
// ---------------------------------------------------------------------------

export async function updateTournamentBaseImages(
  tournamentId: string,
  squareImageId: string | null,
  storyImageId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

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


[truncated at line 200 — original has 553 lines]
```

### `src/components/layout/Sidebar.tsx`

```
"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  Megaphone,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Image,
  Share2,
  Star,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Planner", href: "/planner", icon: CalendarDays },
  { label: "Create", href: "/create", icon: PlusCircle },
  { label: "Tournaments", href: "/dashboard/tournaments", icon: Trophy },
  { label: "Library", href: "/library", icon: Image },
  { label: "Campaigns", href: "/campaigns", icon: Megaphone },
  { label: "Reviews", href: "/reviews", icon: Star },
  { label: "Connections", href: "/connections", icon: Share2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <motion.aside
      initial={{ width: 260 }}
      animate={{ width: collapsed ? 80 : 260 }}
      className="sticky top-0 z-30 hidden h-screen flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex"
    >
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
        {collapsed ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
            <span className="font-heading text-sm font-bold leading-none">C</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
              <span className="font-heading text-sm font-bold leading-none">C</span>
            </div>
            <span className="font-heading text-lg font-bold tracking-tight text-sidebar-foreground">
              CheersAI
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-6">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-200",
                isActive
                  ? "bg-sidebar-primary/90 text-sidebar-primary-foreground shadow-sm before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-0.5 before:rounded-full before:bg-white/60"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm font-medium"
                >
                  {item.label}
                </motion.span>
              )}
              {collapsed && isActive && (
                <div className="absolute left-full z-50 ml-2 whitespace-nowrap rounded bg-popover p-2 text-xs text-popover-foreground shadow-lg">
                  {item.label}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4">
        {!collapsed && (
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">
              C
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">Your Venue</p>
              <p className="truncate text-xs text-sidebar-foreground/50">CheersAI</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="mb-3 flex justify-center">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">
              C
            </div>
          </div>
        )}
        <form action={signOut}>
          <SidebarSignOutButton collapsed={collapsed} />
        </form>
      </div>
    </motion.aside>
  );
}

function SidebarSignOutButton({ collapsed }: { collapsed: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sidebar-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60",
        collapsed && "justify-center px-0",
      )}
    >
      <LogOut size={20} />
      {!collapsed && <span className="text-sm font-medium">{pending ? "Signing out..." : "Sign out"}</span>}
    </button>
  );
}
```

### `src/features/tournament/components/CreateTournamentButton.tsx`

```
'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CreateTournamentModal } from './CreateTournamentModal';

export function CreateTournamentButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        New Tournament
      </button>
      <CreateTournamentModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

### `src/features/tournament/components/CreateTournamentModal.tsx`

```
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import { createTournament } from '@/app/actions/tournament';

interface CreateTournamentModalProps {
  open: boolean;
  onClose: () => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function CreateTournamentModal({ open, onClose }: CreateTournamentModalProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [postTemplate, setPostTemplate] = useState(
    '⚽ {team_a} vs {team_b}\n📅 {date} at {time}\n\n{house_rules}\n\n{booking_url}',
  );
  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'facebook']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function handleNameChange(value: string) {
    setName(value);
    if (!slugManual) setSlug(slugify(value));
  }

  function togglePlatform(platform: string) {
    setPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const result = await createTournament({
        name,
        slug,
        postTemplate,
        platforms,
        postLeadHours: 24,
      });
      if (!result.success) {
        setError(result.error ?? 'Failed to create tournament');
      } else if (result.tournamentId) {
        onClose();
        router.push(`/dashboard/tournaments/${result.tournamentId}`);
      }
    } finally {
      setSaving(false);
    }
  }

  const canCreate = name.trim().length > 0 && slug.length > 0 && postTemplate.trim().length > 0 && platforms.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create Tournament"
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">New Tournament</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. FIFA World Cup 2026"
              className="w-full rounded-md border px-3 py-2 text-sm"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugManual(true);
              }}
              placeholder="world-cup-2026"
              className="w-full rounded-md border px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              URL-friendly identifier. Auto-generated from name.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Post Template <span className="text-muted-foreground">({postTemplate.length}/500)</span>
            </label>
            <textarea
              value={postTemplate}
              onChange={(e) => setPostTemplate(e.target.value.slice(0, 500))}
              className="w-full rounded-md border px-3 py-2 text-sm h-28 resize-none font-mono"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Placeholders: {'{team_a}'}, {'{team_b}'}, {'{date}'}, {'{time}'}, {'{group_round}'}, {'{house_rules}'}, {'{booking_url}'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Platforms</label>
            <div className="flex gap-4">
              {(['instagram', 'facebook'] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                    className="rounded border-gray-300"
                  />
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </label>
              ))}
            </div>
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
          <button
            onClick={handleCreate}
            disabled={saving || !canCreate}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Tournament
          </button>
        </div>
      </div>
    </div>
  );
}
```

### `src/features/tournament/components/TournamentSettingsModal.tsx`

```
'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, ImageIcon, Check } from 'lucide-react';
import type { Tournament } from '@/types/tournament';
import {
  updateTournament,
  updateTournamentStatus,
  updateTournamentBaseImages,
  getMediaAssetsForPicker,
} from '@/app/actions/tournament';
import type { PickerAsset } from '@/app/actions/tournament';

interface TournamentSettingsModalProps {
  tournament: Tournament;
  open: boolean;
  onClose: () => void;
}

export function TournamentSettingsModal({
  tournament,
  open,
  onClose,
}: TournamentSettingsModalProps) {
  const [name, setName] = useState(tournament.name);
  const [houseRulesText, setHouseRulesText] = useState(tournament.houseRulesText ?? '');
  const [postTemplate, setPostTemplate] = useState(tournament.postTemplate);
  const [postLeadHours, setPostLeadHours] = useState(tournament.postLeadHours);
  const [platforms, setPlatforms] = useState(tournament.platforms);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [squareImageId, setSquareImageId] = useState(tournament.baseImageSquareId);
  const [storyImageId, setStoryImageId] = useState(tournament.baseImageStoryId);
  const [assets, setAssets] = useState<PickerAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const assetsLoaded = useRef(false);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || assetsLoaded.current) return;
    assetsLoaded.current = true;
    setAssetsLoading(true);
    getMediaAssetsForPicker()
      .then(setAssets)
      .finally(() => setAssetsLoading(false));
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await updateTournament(tournament.id, {
        name,
        houseRulesText: houseRulesText || null,
        postTemplate,
        postLeadHours,
        platforms,
      });
      if (!result.success) {
        setError(result.error ?? 'Failed to save');
        return;
      }

      const imagesChanged =
        squareImageId !== tournament.baseImageSquareId ||
        storyImageId !== tournament.baseImageStoryId;
      if (imagesChanged) {
        const imgResult = await updateTournamentBaseImages(
          tournament.id,
          squareImageId,
          storyImageId,
        );
        if (!imgResult.success) {
          setError(imgResult.error ?? 'Failed to save base images');
          return;
        }
      }

      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: 'draft' | 'active' | 'archived') {
    setSaving(true);
    try {
      await updateTournamentStatus(tournament.id, status);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function togglePlatform(platform: 'instagram' | 'facebook') {
    setPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tournament Settings"
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg bg-background p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Tournament Settings</h2>
          <button onClick={onClose} aria-label="Close settings">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              House Rules{' '}
              <span className="text-muted-foreground">({houseRulesText.length}/200)</span>
            </label>
            <textarea
              value={houseRulesText}
              onChange={(e) => setHouseRulesText(e.target.value.slice(0, 200))}
              className="w-full rounded-md border px-3 py-2 text-sm h-20 resize-none"
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Post Template{' '}
              <span className="text-muted-foreground">({postTemplate.length}/500)</span>
            </label>
            <textarea
              value={postTemplate}
              onChange={(e) => setPostTemplate(e.target.value.slice(0, 500))}
              className="w-full rounded-md border px-3 py-2 text-sm h-32 resize-none font-mono"
              maxLength={500}
              placeholder="Placeholders: {team_a}, {team_b}, {date}, {time}, {group_round}, {house_rules}, {booking_url}"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Post Lead Time</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={postLeadHours}
                onChange={(e) =>
                  setPostLeadHours(Math.max(1, Math.min(168, parseInt(e.target.value) || 24)))
                }
                className="w-20 rounded-md border px-3 py-2 text-sm"
                min={1}
                max={168}
              />
              <span className="text-sm text-muted-foreground">hours before kick-off</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Platforms</label>
            <div className="flex gap-4">
              {(['instagram', 'facebook'] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                    className="rounded border-gray-300"
                  />
                  {p.charAt(0).toUpperCase() + p.slice(1)}

[truncated at line 200 — original has 338 lines]
```

## Related Files (grep hints)

These files reference the basenames of changed files. They are hints for verification — not included inline. Read them only if a specific finding requires it.

```
.agents/skills/obsidian-docs/SKILL.md
.agents/skills/obsidian-docs/references/change-request-protocol.md
.agents/skills/obsidian-docs/references/templates.md
.claude/skills/obsidian-docs/SKILL.md
.claude/skills/obsidian-docs/references/change-request-protocol.md
.claude/skills/obsidian-docs/references/templates.md
BACKLOG.md
CLAUDE.md
HANDOFF.md
Obsidian/OJ-CheersAI2.0/.obsidian/core-plugins.json
```

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

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

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md`

```markdown
# Supabase Conventions

## Client Patterns

Two Supabase client patterns — always use the correct one:

```typescript
// Server-side auth (anon key + cookie session) — use for auth checks:
const supabase = await getSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();

// Server-side data (service-role, bypasses RLS) — use for system/cron operations:
const db = await getDb(); // or createClient() with service role
const { data } = await db.from("table").select("*").eq("id", id).single();

// Browser-only (client components):
const supabase = getSupabaseBrowserClient();
```

ESLint rules should prevent importing the admin/service-role client in client components.

## snake_case ↔ camelCase Conversion

DB columns are always `snake_case`; TypeScript types are `camelCase` with Date objects. Always wrap DB results:

```typescript
import { fromDb } from "@/lib/utils";
const record = fromDb<MyType>(dbRow); // converts snake_case keys + ISO strings → Date
```

All type definitions should live in a central types file (e.g. `src/types/database.ts`).

## Row Level Security (RLS)

- RLS is always enabled on all tables
- Use the anon-key client for user-scoped operations (respects RLS)
- Use the service-role client only for system operations, crons, and webhooks
- Never disable RLS "temporarily" — create a proper service-role path instead

## Migrations

```bash
npx supabase db push          # Apply pending migrations
npx supabase migration new    # Create a new migration file
```

- Migrations live in `supabase/migrations/`
- Full schema reference in `supabase/schema.sql` (paste into SQL Editor for fresh setup)
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval
- Test migrations locally with `npx supabase db push --dry-run` before pushing (see `verification-pipeline.md`)

### Dropping columns or tables — mandatory function audit

When a migration drops a column or table, you MUST search for every function and trigger that references it and update them in the same migration. Failing to do so leaves silent breakage: PL/pgSQL functions that reference a dropped column/table throw an exception at runtime, and if any of those functions have an `EXCEPTION WHEN OTHERS THEN` handler, the error is swallowed and returned as a generic blocked/failure state — making the bug invisible until someone notices the feature is broken.

**Before writing any `DROP COLUMN` or `DROP TABLE`:**

```sql
-- Find all functions that reference the column or table
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%column_or_table_name%'
  AND routine_type = 'FUNCTION';
```

Or search the migrations directory:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -l
```

For each function found: update it in the same migration to remove or replace the reference. Never leave a function referencing infrastructure that no longer exists.

This also applies to **triggers** — check trigger functions separately:
```bash
grep -r "column_or_table_name" supabase/migrations/ --include="*.sql" -n
```

## Auth

- Supabase Auth with JWT + HTTP-only cookies
- Auth checks happen in layout files or middleware
- Server actions must always re-verify auth server-side (never rely on UI hiding)
- Public routes must be explicitly allowlisted

## Audit Logging

All mutations (create, update, delete) in server actions must call `logAuditEvent()`:

```typescript
await logAuditEvent({
  user_id: user.id,
  operation_type: 'update',
  resource_type: 'thing',
  operation_status: 'success'
});
```
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/ui-patterns.md`

```markdown
# UI Patterns & Component Standards

## Server vs Client Components

- Default to **Server Components** — only add `'use client'` when you need interactivity, hooks, or browser APIs
- Server Components can fetch data directly (no useEffect/useState for data loading)
- Client Components should receive data as props from server parents where possible

## Data Fetching & Display

Every data-driven UI must handle all three states:
1. **Loading** — skeleton loaders or spinners (not blank screens)
2. **Error** — user-facing error message or error boundary
3. **Empty** — meaningful empty state component (not just no content)

## Forms

- Use React Hook Form + Zod for validation where configured
- Validation errors displayed inline, not just console logs
- Required field indicators visible
- Loading/disabled state during submission (prevent double-submit)
- Server action errors surfaced to user via toast or inline message
- Form reset after successful submission where appropriate

## Buttons

Check every button for:
- Consistent variant usage (primary, secondary, destructive, ghost) — no ad-hoc Tailwind-only buttons
- Loading states on async actions (spinner/disabled during server action calls)
- Disabled states when form is invalid or submission in progress
- `type="button"` to prevent accidental form submission (use `type="submit"` only on submit buttons)
- Confirmation dialogs on destructive actions (delete, archive, bulk operations)
- `aria-label` on icon-only buttons

## Navigation

- Breadcrumbs on nested pages
- Active state on current nav item
- Back/cancel navigation returns to correct parent page
- New sections added to project navigation with correct permission gating
- Mobile responsiveness of all nav elements

## Permissions (RBAC)

- Every authenticated page must check permissions via the project's permission helper
- UI elements (edit, delete, create buttons) conditionally rendered based on permissions
- Server actions must re-check permissions server-side (never rely on UI hiding alone)

## Accessibility Baseline

These items are also enforced in the Definition of Done (`definition-of-done.md`):

- Interactive elements have visible focus styles
- Colour is not the only indicator of state
- Modal dialogs trap focus and close on Escape
- Tables use proper `<thead>`, `<th scope>` markup
- Images have meaningful `alt` text
- Keyboard navigation works for all interactive elements
```

---

_End of pack._
