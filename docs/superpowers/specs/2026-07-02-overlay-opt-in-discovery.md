# Discovery: Opt-in Per-Post Overlays (Banners) at Approval Time

**Date:** 2026-07-02
**Status:** Discovery only — no code changed
**Trigger:** Weekly recurring posts get a gold overlay strip down the right-hand side by
default. The user wants overlays to be **opt-in**, entered as free text **per post at the
approval step** (right after generation), not applied automatically.

> Terminology: what the user calls an "overlay" is called a **"banner"** everywhere in the
> code. The right-hand-side gold strip is a banner.

---

## Summary

The right-side overlay is **not a user preference — it is on by default from two independent
sources, and its position is a hard-coded constant**. Delivering "opt-in per post at approval"
is mostly a **wiring change** (no schema migration for the core work), but there are three
correctness traps that must be handled or the opt-in guarantee silently breaks. There is also a
genuine semantic wrinkle for *recurring* campaigns: future weeks are generated later by a
background worker the user never sees at approval time, so "per post at approval" can only bind
to the posts visible at approval — future weeks need a separate rule.

---

## How overlays (banners) work today

Banner config lives at **two levels, merged at render time**:

- **Account default** — `posting_defaults.banners_enabled`, `DEFAULT true NOT NULL`
  (`supabase/baseline/v1_baseline.sql:400`); app fallback also defaults to `true`
  (`src/lib/settings/data.ts:203`).
- **Per-post override** — nullable columns already exist on `content_variants`:
  `banner_enabled`, `banner_text_override`, `banner_position`, `banner_bg`,
  `banner_text_colour` (`supabase/baseline/v1_baseline.sql:231-235`).

The resolver merges them (`src/lib/banner/config.ts:40-51`):

```ts
enabled: postOverrides.banner_enabled ?? accountDefaults.banners_enabled,
position: FIXED_BANNER_POSITION,   // 'right' — HARD-CODED constant
bgColour: FIXED_BANNER_BG,         // '#a57626' gold — hard-coded
textColour: FIXED_BANNER_TEXT,     // '#FFFFFF' — hard-coded
textOverride: postOverrides.banner_text_override,
```

So in practice **only two things are per-post today**: whether it's on (`banner_enabled`) and
the text (`banner_text_override`). `banner_position` / `banner_bg` / `banner_text_colour`
columns are written by some paths but **ignored at render** — they are dormant.

- Position/colour constants are **duplicated** in the Deno worker copy
  `supabase/functions/publish-queue/banner-config.ts:33-49` — any position/colour change must
  be made in both trees or the live output diverges from the preview.
- Default text is an auto "proximity label" (TONIGHT / THIS FRIDAY / SAT 12 JUL,
  `src/lib/scheduling/proximity-label.ts`), **tiled 21×** down the strip
  (`BANNER_LABEL_REPEAT_COUNT = 21`, `src/lib/banner/palette.ts:34`).
- Rendering happens twice: a live React preview
  (`src/features/planner/banner-overlay.tsx`) and the real published image, composed at send
  time by the Deno publish worker (`supabase/functions/publish-queue/worker.ts:225+`) which
  POSTs to `POST /api/internal/render-banner` (Sharp + text-to-svg).

---

## Root cause — why recurring posts show the right-side overlay

**Two independent producers, both default-on** (this is the key correction: it is *not* just
the worker):

1. **The approved slots the user sees at generation** are written by `createScheduledBatch`,
   whose variant write sets only `body`, `preview_data`, `media_ids` — **no banner columns at
   all** (`src/app/actions/content.ts:830-836`). With `banner_enabled` left NULL, the resolver
   falls back to the **account default `true`** (`config.ts:45`) → gold strip on the right.
2. **Future weeks of the recurring campaign** are materialised later by the
   `materialise-weekly` edge worker, which **force-writes `banner_enabled: true`** on every
   generated post whenever the campaign carries banner defaults
   (`supabase/functions/materialise-weekly/worker.ts:293-303`). The wizard always seeds
   `bannerDefaults` from account defaults (`src/features/create/create-wizard.tsx:90,188-189`),
   so that force-true branch is effectively always taken.

Position in both cases is the hard-coded `'right'` constant (`config.ts:36`,
`publish-queue/banner-config.ts:33`), so it can't be moved from the UI.

**Contrast — instant one-off posts don't have this problem** because they write an *explicit*
`banner_enabled` (`{ banner_enabled: false }` when off,
`src/lib/create/service.ts:121-136`). Campaign/recurring flows either leave it NULL (→ inherits
`true`) or force it true. That asymmetry is exactly why a one-off can be banner-free but a
weekly recurring post can't.

**Live-path note:** per project memory the Supabase edge function `materialise-weekly` is the
production materialiser, not the Node `src/lib/scheduling/materialise.ts`. Confirm against the
QStash/cron schedule before shipping the worker fix.

---

## How the create / approve flow works today

4-step wizard (`src/features/create/create-wizard.tsx`): Brief → Media → Schedule → Generate.
Approval happens entirely in the final **Generate** step
(`src/features/create/steps/generate-step.tsx`).

Each generated slot is an expandable card with per-post controls already present: inline copy
edit (`handleEditCopy`), per-card media swap (`handleSlotMediaChange`), modifier chips, an
"Approve this post" button (`handleToggleApprove`), and a **live `BannerOverlay` preview
already rendering in the card** (`generate-step.tsx:867`).

On the final action, `onScheduleAll`/`onQueueAll` (`create-wizard.tsx:543-598`) build a
`slotCopies` array and call `createScheduledBatch` (`content.ts:639`).

**There is no overlay control in this flow today.** `SlotGeneratedCopy`
(`src/types/content.ts:63-75`) has no banner field, and `createScheduledBatch` writes no banner
columns. The only existing per-post overlay editor is post-hoc, in the planner
(`src/features/planner/banner-controls.tsx` → `updatePlannerBannerConfig`).

---

## What needs to change

### (a) Neutralise the default so un-opted posts get NO overlay

- **Approved slots:** in `createScheduledBatch` variant write
  (`content.ts:830-836`) set an **explicit `banner_enabled`** per slot — `false` when no
  overlay text was typed, `true` when it was. This is the fix for the posts the user actually
  sees at approval.
- **Future weeks:** in `materialise-weekly/worker.ts:295` remove the hard-coded
  `banner_enabled: true`. Decide the default for auto-generated weeks (see decisions).
- Optionally flip the account default `posting_defaults.banners_enabled true→false`
  (`v1_baseline.sql:400`) + app fallback (`settings/data.ts:203`). **This changes behaviour for
  every account and needs a migration** — treat as a separate decision, not part of the minimal
  fix.

### (b) Add the per-post overlay TEXT input at approval

- `src/types/content.ts:63-75` — add `bannerTextOverride?: string | null` (and
  `bannerEnabled?: boolean`) to `SlotGeneratedCopy`.
- `src/features/create/steps/generate-step.tsx` — add a text input inside each expanded card,
  next to the existing `BannerOverlay` preview (~`:829-990`), with a handler mirroring
  `handleSlotMediaChange`. **Reuse the proven planner pattern**
  (`src/features/planner/banner-controls.tsx:120-151`): 20-char input + "Auto" reset + live
  preview.

### (c) Persist it

- `create-wizard.tsx:543-598` — include the overlay value in the `slotCopies` mapping.
- `content.ts:613-620` — add the field(s) to `CreateScheduledBatchInput.slotCopies`.
- `content.ts:830-836` — write `banner_text_override` + `banner_enabled` per slot. The write
  already fans out one variant per item per platform, so the same override naturally applies to
  all platform variants of a slot.
- Validate server-side; **match the render endpoint's constraints** (see trap #3), not just
  `max(20)`.

### (d) Apply at render — mostly free

The resolver already reads `banner_enabled` + `banner_text_override` (`config.ts:45,49`, plus
the Deno copy), so once (c) writes those columns, **both preview and live publish honour them
automatically**. No render change needed unless you also want configurable *position* (that's a
change to `FIXED_BANNER_POSITION` in both trees).

---

## Three correctness traps (must handle or opt-in silently breaks)

1. **The planner can't turn a banner OFF.** `banner-controls.tsx:56-63` hard-codes
   `banner_enabled: true` on every persist. So if the create step writes `false`, a user who
   later edits that post's text in the planner **silently re-enables the banner**. Fix the
   planner persist to carry the real enabled state, or the opt-in guarantee only holds until the
   first later edit.
2. **Recurring semantic wrinkle.** Per-post text typed at approval binds only to the slots
   `createScheduledBatch` writes. Future weeks are generated by the worker, which currently
   knows only a single campaign-level `bannerDefaults.customMessage`
   (`worker.ts:299-303`) — it has no per-week text. So "opt-in per post at approval" cannot
   cover weeks the user never saw. Decide the rule for future weeks (default OFF recommended).
3. **Free-text charset/length mismatch.** The render endpoint enforces `MAX_LABEL_LENGTH = 60`
   and a `LABEL_PATTERN` charset (`render-banner/route.ts:77,83,100,103`). The planner/create
   validation only checks `max(20)` with **no charset check** (`planner/actions.ts:1041`). Text
   with a disallowed char (emoji, `£`, `*`, `+`, `~`, …) passes save but **the live render
   rejects it while the preview shows it fine**. Add a charset check matching `LABEL_PATTERN` to
   the input + server action.

Plus one UX note: custom text is **tiled 21× down the strip** (`palette.ts:34`). A short word
like "QUIZ" repeats all the way down. Confirm that's the intended look.

---

## Data model impact

**No migration for the core work** — the per-post columns already exist on `content_variants`
(`v1_baseline.sql:231-235`). A migration is only needed if you flip the account-level default
`banners_enabled true→false` (a `DEFAULT` change on an existing column — must be a new
migration; the v1 baseline is not re-run against production).

---

## Decisions for the user

1. **Default for un-opted posts:** OFF (recommended, matches "opt-in") vs inherit account
   default. Recommendation: OFF — write explicit `banner_enabled: false` from approval when no
   text is typed, so we don't depend on flipping the global default.
2. **Does typing text auto-enable that post's banner?** Recommendation: **yes** (mirrors the
   instant-post contract).
3. **Future weeks of a recurring campaign:** OFF by default, or carry a campaign-level default
   message? Recommendation: OFF unless the user sets a campaign-level default.
4. **Backfill:** existing recurring posts already have `banner_enabled: true` (worker) or NULL
   (approved slots inheriting `true`). Fix new posts only, or run a one-off script to turn old
   ones OFF? This touches user data — needs explicit approval.
5. **Position:** stay hard-coded `'right'` when shown, or make it configurable / move it?
6. **Planner OFF-state:** fix the planner's hard-coded `banner_enabled: true` so opt-in OFF
   survives later edits? (Recommended — see trap #1.)
7. **Stories:** stories are media-only with no copy editing (`generate-step.tsx:777-826`) —
   include the overlay input for stories, or feed posts only?

---

## Complexity & risk

**Complexity: 3 (Medium)**, rising to **4** if you also flip the account default (+migration
+backfill) or activate per-post position. Files: `generate-step.tsx`, `create-wizard.tsx`,
`src/types/content.ts`, `content.ts`, `materialise-weekly/worker.ts`, and `banner-controls.tsx`
(trap #1) — ~6-7 files, plus tests.

**Risks:** dual banner code trees (preview vs Deno worker); the worker deploys separately from
the app (deploy the force-true removal first or together to avoid a window where the UI writes
OFF but the old worker re-enables); the resolver fails *silently* (a wiring mistake just falls
back to the default rather than erroring — verify via the in-card live preview and a real
publish).

**Tests needed:** resolver with `banner_enabled:false` + override present; `createScheduledBatch`
persists `banner_enabled`/`banner_text_override`; regression that the removed force-true leaves
recurring variants OFF; charset validation rejects out-of-pattern text before render.

**Suggested increment order:**
1. **Bug fix first (standalone, high value):** stop the two default-on sources — write explicit
   `banner_enabled` in `createScheduledBatch`, remove force-true in the worker; verify new
   weekly posts render no overlay.
2. **Add the approval input + persistence** (b)+(c), with charset validation matching the render
   endpoint.
3. **Fix the planner OFF-state** (trap #1) so opt-in survives later edits.
4. **Optional/decisions:** account-default flip (+migration) and/or backfill — only after
   decisions 1 & 4.

---

## Files referenced (verified this pass)

- `src/lib/banner/config.ts:36-51` — resolver, hard-coded position/colour
- `src/app/actions/content.ts:639,707-742,748-840` — createScheduledBatch (writes no banner cols)
- `supabase/functions/materialise-weekly/worker.ts:161,293-314` — force-true on future weeks
- `src/lib/create/service.ts:121-136` — instant-post explicit banner_enabled contract
- `src/features/create/steps/generate-step.tsx:663,867` — approval cards + live preview
- `src/features/planner/banner-controls.tsx:56-63,120-151` — planner editor, hard-codes enabled:true
- `src/app/(app)/planner/actions.ts:1036-1079` — updatePlannerBannerConfig, max(20) validation
- `src/app/api/internal/render-banner/route.ts:77,83,100,103` — MAX_LABEL_LENGTH 60 + LABEL_PATTERN
- `src/lib/banner/palette.ts:34` — BANNER_LABEL_REPEAT_COUNT = 21
- `supabase/baseline/v1_baseline.sql:231-235,400` — per-post columns + account default true
