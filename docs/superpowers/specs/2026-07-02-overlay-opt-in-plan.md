# Implementation Plan — Opt-in per-post image overlays (CheersAI 2.0)

**Date:** 2026-07-02 · **Status:** Plan (no code changed) · British English
Merges two independent discoveries (6-change spine) + three verified additions (shared charset
validator, future-weeks rule, operational handling). All file:line refs verified against the
working tree. Goal-backward checked; plan-check corrections folded in.

Companion discovery: [2026-07-02-overlay-opt-in-discovery.md](2026-07-02-overlay-opt-in-discovery.md)

---

## Goal & acceptance criteria

- A newly generated post renders with **no overlay** unless the owner typed overlay text at
  approval. (Today it inherits the account default `banners_enabled = true`
  [v1_baseline.sql:400] because the variant's `banner_enabled` is written `NULL` and the
  resolver falls back [config.ts:45].)
- Typing overlay text on an approval card shows it live in the card preview and renders that
  exact text on publish.
- A newly materialised **future week** of a recurring campaign renders with **no overlay** by
  default. (Today [materialise-weekly/worker.ts:295] hard-codes `banner_enabled: true`.)
- A post opted **OFF** stays OFF after any later planner edit. (Today [banner-controls.tsx:60]
  hard-codes `banner_enabled: true` on every save.)
- `£5 PINTS` is accepted end-to-end **or** blocked at the input with a clear message — never
  saved then 400ed at publish. (Today the render endpoint's `LABEL_PATTERN`
  [render-banner/route.ts:83] excludes `£`/emoji → 400 fails the whole job.)
- **Story** placements never write an enabled banner (stories render no overlay), even when the
  slot has overlay text.
- `banner_enabled: true` **always** implies a non-empty normalised label (no "enabled but
  blank" state can be written by any path).
- Text can never violate the DB `char_length <= 20` CHECK [v1_baseline.sql:239] — capped/rejected
  before the upsert.

---

## Assumptions & decisions (recommended defaults)

1. **Un-opted post = OFF.** Blank text ⇒ write explicit `banner_enabled = false` (never `NULL`),
   so the resolver's `?? accountDefaults` fallback can't re-enable it. *Feature intent — no
   confirmation needed.*
2. **Typing text auto-enables.** `enabled = normalise(text).length > 0`; no separate toggle. *No
   confirmation needed.*
3. **Future recurring weeks = OFF** (Option A) unless a campaign-level default is set (Option B).
   Recommend **A** — B reintroduces the "text the owner never re-reviews" risk this feature
   removes. **CONFIRM.**
4. **Charset: allow `£`, exclude emoji** for v1. `£` is core pub pricing; emoji complicate SVG
   render + the char-length CHECK. **CONFIRM emoji exclusion acceptable.**
5. **Length cap = 20** (align to the DB CHECK; relax the endpoint's 60 down to 20 in the shared
   validator). *No confirmation needed — DB CHECK is binding.*
6. **Do NOT flip the global account default** `posting_defaults.banners_enabled` (would need a
   migration + change all `NULL` variants). Make every writer explicit instead. **CONFIRM only
   if a global flip is wanted.**
7. **Backfill of existing posts: none without sign-off.** Existing `banner_enabled = NULL`/`true`
   rows keep showing overlays until regenerated. Because the reported pain is on *existing*
   weekly posts, a scoped, non-destructive backfill is likely wanted. **CONFIRM.**

---

## Increments (3-change rule: ≤3 atomic changes → lint/typecheck/test/build → commit)

### Increment 1 — Stop both default-on sources (standalone bug fix, ships alone)

Turns overlays from silently-on to explicitly-off wherever new content is written. No UI yet.

- **1a. `src/app/actions/content.ts` variantPayloads (~810–835).** Add explicit banner columns
  so wizard variants never write `NULL`:
  ```ts
  banner_enabled: placement === 'story' ? false : false, // explicit false; story always false
  banner_text_override: null,
  ```
  (Increment 3 replaces the feed value with the typed-text logic; the story guard stays.)
- **1b. `supabase/functions/materialise-weekly/worker.ts` (~293–314).** Write
  `banner_enabled: false` **unconditionally** for materialised variants (drop the
  `banner_enabled: true` line and the conditional `bannerOverride` spread). Confirmed:
  `buildCampaignMetadata` never sets `metadata.bannerDefaults` for weekly
  [build-campaign-metadata.ts:57–64], so `parseBannerDefaults` already returns `null` — the
  force-on came purely from the `NULL`→account-default fallback.
- **Verify:** unit test asserts `createScheduledBatch` upsert has `banner_enabled === false`;
  worker payload-shape test asserts `false` regardless of `bannerDefaults`. Manual: new wizard
  post → `content_variants.banner_enabled = false`.
- **Deploy:** 1a ships with the app; **1b needs `supabase functions deploy materialise-weekly`**.

### Increment 2 — Shared charset/length validator (foundation)

- **New `src/lib/banner/text.ts`** — exports `MAX_BANNER_TEXT_LENGTH = 20`,
  `BANNER_TEXT_PATTERN = /^[\w\s\-:.,!?'"&%@#()/£]+$/u` (render pattern + `£`, emoji excluded),
  `normaliseBannerText(input): string | null` (strip control chars, collapse whitespace, trim,
  uppercase, grapheme-truncate to 20, `null` when empty), `validateBannerText(input): {ok:true;
  value} | {ok:false; reason}`. Reuse the `Intl.Segmenter` grapheme pattern from
  [scheduling/banner-config.ts:63–66].
- **`src/app/api/internal/render-banner/route.ts` (77, 83, 97–105).** Replace local
  `MAX_LABEL_LENGTH`/`LABEL_PATTERN` + the label branch of `validateBody` with
  `validateBannerText(v.label)`; keep `"label"` as the failure reason. **This app endpoint is the
  real 400-gate** (the publish worker POSTs to it), so widening it to accept `£` is the single
  change that closes the trap.
- **Deno mirror `supabase/functions/publish-queue/banner-text.ts`** — *normalisation parity
  only* (no `@/` imports). The worker pre-normalises the stored override before sending so the
  published label matches what was validated. It is **not** a second validation gate, so a stale
  mirror causes at most cosmetic label drift, not a 400. Keep it minimal + a drift test.
- **New `src/lib/banner/text.test.ts`** — incl. a drift test reading the Deno file as text and
  asserting identical `MAX` + pattern.
- **Pre-flight:** confirm `renderBannerServer` XML-escapes `&`/`<`/`>` independently of the
  pattern before widening charset (`£` is not an XML meta-char, so expected no-op — verify).

### Increment 3 — Approval-card input + wizard plumbing + server persist (the feature)

Depends on 1 & 2. Land together.

- **3a. `src/types/content.ts` `SlotGeneratedCopy` (after ~74).**
  `bannerTextOverride?: string; // blank/undefined = no overlay`
- **3b. `src/app/actions/content.ts` `CreateScheduledBatchInput.slotCopies` (~613–620).** Add
  `bannerTextOverride?: string;`.
- **3c. `content.ts` variantPayloads (replacing 1a's feed stub).** Per slot:
  ```ts
  const overlay = normaliseBannerText(slot.bannerTextOverride);
  banner_enabled: placement === 'story' ? false : overlay !== null,
  banner_text_override: placement === 'story' ? null : overlay,
  ```
  Before the loop, reject the whole batch (`{ error }`) if any non-blank slot fails
  `validateBannerText` — mirrors the brief re-validation gate at [content.ts:665–668]. Overlay is
  derived once per slot and written to every platform variant of that slot.
- **3d. `src/features/create/create-wizard.tsx` (both mappings ~545–553 & ~573–581).** Add
  `bannerTextOverride: sc.bannerTextOverride` to each mapped object.
- **3e. `src/features/create/steps/generate-step.tsx` (ready block ~829–992, non-story only).**
  Per-slot free-text input mirroring `handleSlotMediaChange` (immutable `.map` +
  `onSlotCopiesChange`); `maxLength={20}`; on change run `normaliseBannerText`; on blur show a
  validation message if `validateBannerText` fails **and disable "Approve this post" for that
  slot while invalid** (so the user never approves text that the server batch would reject).
  Re-point the preview gate (~866–872): overlay preview shows only when *that slot's* text is
  non-blank, not the account default. Drop the `publishMode === 'schedule'` condition so Post-Now
  previews match (`buildInstantBannerOverride` already supports per-post enabled).
- **Pre-flight:** confirm the draft-save Zod schema on `body_draft`/`DraftState.generatedSlotCopies`
  doesn't reject the new key on resume.

### Increment 4 — Planner OFF-state trap fix

- **`banner-controls.tsx` persist() (~60).** Replace `banner_enabled: true` with
  `banner_enabled: (next.banner_text_override ?? '').trim().length > 0`.
- **`banner-controls.tsx` sanitiser (~26–32).** Replace local `sanitiseTextOverride` with
  `normaliseBannerText`; toast on blur when `validateBannerText` fails.
- **UX copy (~102–104, 116, 129, 136–146).** "Add overlay text to switch it on; leave blank for
  no overlay." Preview shows muted "No overlay" when blank instead of an auto label. Relabel
  "Auto" → "Turn off / Clear". Keep the counter at **20**.
- **`src/app/(app)/planner/actions.ts` `updateBannerSchema.textOverride` (~1041).** Replace
  `z.string().max(20).nullable()` with charset+length validation via `validateBannerText` and
  persist `normaliseBannerText(...)`; `null` = off bypasses the check.
- **Verify (regression gate):** a post written `banner_enabled: false` at create survives a
  blank-text planner re-save as `false`. Update existing tests that assert `true` on save.

### Increment 5 — (optional) campaign-level default overlay for future weeks

Only if decision 3 = Option B. New opt-in field in `weekly-recurring-fields.tsx` +
`weeklyCampaignBriefSchema`, `buildCampaignMetadata` writing `bannerDefaults`, worker setting
`banner_enabled: !!bannerDefaults` + carrying a validated `banner_text_override`. **Not
recommended — defer.**

---

## Data & deploy

- **No migration for core work** — columns already exist [v1_baseline.sql:231–239]; we change
  values, not schema. The `char_length <= 20` CHECK stays, respected by the shared cap.
- **Deploy targets:** (1) Next.js/Vercel — 1a, 2, 3, 4; (2) Deno edge —
  `supabase functions deploy materialise-weekly` (1b) and `publish-queue` (mirror + worker in 2).
  Ship together. The 400-gate is the app endpoint, so app-first is safe; the only staggering risk
  is cosmetic label drift if the `publish-queue` mirror lags.
- **Backfill (sign-off required, non-destructive):** dry-run count then, in a transaction,
  `UPDATE content_variants SET banner_enabled = false WHERE banner_enabled IS NULL AND <future /
  unpublished>` — scoped to future/unpublished content only. Present the row count first. **Do
  not run without explicit sign-off.**

---

## Tests

- **content action:** no text → `false`/`null`; `"£5 PINTS"` → `true` + `"£5 PINTS"`; 25 chars →
  rejected/capped per validator; emoji → rejected; **story placement → `banner_enabled: false`
  even with slot text**.
- **`banner/text.test.ts`:** blank→null; control chars stripped; `£` accepted; emoji rejected;
  >20 graphemes truncated; uppercase; **Deno mirror drift test**.
- **generate-step.test.tsx:** preview hidden until text typed; Approve disabled while text
  invalid; story path has no input.
- **banner-controls.test.tsx:** blank save → `false`; a `false` post survives blank re-save as
  `false` (trap regression); `£` handled.
- **worker:** payload always `banner_enabled: false`; **invariant test: `banner_enabled: true`
  ⇒ non-empty normalised label** at the publish boundary.
- **render-banner:** still 400s on empty/over-length; now accepts `£`.

---

## Complexity, risks, rollback

**Complexity: 4 (L)** — ~8 app files + 2 Deno files, no schema change, two deploy targets,
behaviour change in three flows. Split into 4 shippable increments (5th optional), each within
300–500 lines. **Increment 1 alone fixes the reported bug** and is independently valuable.

**Risks:** resolver `NULL`→default trap (mitigated by always writing explicit `false`); app/worker
mirror drift (mitigated by drift test + it's cosmetic-only); removal of "blank = auto label" in
the planner is a visible behaviour change (flag to product); `£`/emoji + backfill are product
decisions.

**Rollback:** each increment reverts cleanly with no data migration to undo (Inc 1 → overlays-on;
Inc 2 → endpoint back to 60/no-£; Inc 3 → input gone, posts fall back to Inc 1's `false`; Inc 4 →
planner back to forcing `true`).

---

## Pre-flight checks (resolve at coding, not guessed)
1. `renderBannerServer` XML-escaping independent of the pattern before widening charset (Inc 2).
2. Draft-save Zod schema accepts the new `bannerTextOverride` key on resume (Inc 3).
3. Planner input `maxLength`/counter current values before aligning to 20 (Inc 4).
4. Confirm `publish-queue` edge function is the live publish path reading these columns (per
   project memory it is, not `handler.ts`).
