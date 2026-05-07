# Wave 3 / Worker + cleanup — Handoff

## Outputs

- `supabase/functions/publish-queue/worker.ts` (modified — Task 11)
  - Replaced legacy `resolveWorkerBannerLabel` / `getBannerPublishBlockReason` /
    `getBannerSourceBlockReason` machinery with an inline preflight render via
    `renderBannerServer` (Sharp).
  - Reads new banner override columns from `content_variants` and account-level
    defaults from `posting_defaults`, resolves via `bannerConfigResolver`,
    computes the proximity label via `getProximityLabel` + `extractCampaignTiming`,
    renders inline, uploads under `banners/{contentId}/{variantId}.jpg`, and
    overrides the first media path on the way to the platform call.
  - Render failures throw `BANNER_RENDER_FAILED: <cause>` and the job is marked
    failed without any platform call.
- `tests/publish-queue.test.ts` (modified — Task 11 step 2)
  - Removed the obsolete `getBannerPublishBlockReason` tests.
  - Updated `loadVariant` mocks to the new override columns.
  - Added two new tests in a `banner preflight render` describe block:
    one for the BANNER_RENDER_FAILED path that asserts the platform is never
    called, and one for the disabled-at-account-level path that asserts the
    upload-bucket render is never invoked.
- `supabase/migrations/20260507100100_banner_overlay_drop_columns.sql` (new — Task 12)
- `supabase/functions/materialise-weekly/worker.ts` (modified — Task 13 follow-up)
  - This file was the **second** runtime caller of the now-deleted
    `/api/internal/render-banner` endpoint and was writing `banner_state` into
    `content_variants`. After Migration 2 dropped that column it would have
    failed at runtime. Replaced both: writes the new banner override columns
    instead, and the per-render call is gone (the publish worker handles it).
  - Inlined a small `BANNER_COLOUR_HEX` map to keep the Deno edge function
    free of `@/...` aliases (mirrors the same map exported from
    `src/lib/scheduling/banner-config.ts`).
- Deletions per Task 13 (each verified via grep before removing):
  - `src/lib/scheduling/banner-canvas.ts`
  - `src/lib/scheduling/banner-canvas.test.ts`
  - `src/lib/scheduling/banner-renderer.server.ts`
  - `src/app/api/internal/render-banner/route.ts`
  - `scripts/ops/repair-banner-overlays.ts`
  - `src/features/planner/banner-rendered-preview.tsx`
  - `src/features/planner/banner-overlay-preview.tsx`
  - `src/features/planner/use-banner-prerender.ts` (Wave 2 had flagged this as
    safe-to-delete; once `renderPlannerContentBanner` was removed it had no
    importable surface left)
  - `tests/lib/scheduling/banner-renderer.server.test.ts` (paired with
    `banner-renderer.server.ts`; the failing case Wave 2 noted is gone with
    the deletion)
- `package.json` — removed the `ops:repair-banners` script entry.
- `src/app/(app)/planner/actions.ts` — legacy callers cleaned per cleanup spec:
  - `approveDraftContent` (a.k.a. "approvePlannerContent"): all banner branches
    dropped — banner validation, storage path verification, banner state
    transitions, and the `banner_*` UPDATE payloads. Now a clean approve →
    enqueue flow.
  - `updatePlannerContentSchedule` (a.k.a. "enqueuePlannerContent"): the
    `renderBannerForContent` + `resetBannerStateForContent` block is gone.
  - `updatePlannerContentMedia`: dropped the `resetBannerStateForContent` call.
  - `restorePlannerContent`: dropped the `renderBannerForContent` /
    `resetBannerStateForContent` retry block.
  - `renderPlannerContentBanner` (server action): deleted entirely.
  - `createBannerUploadUrl` (server action): deleted entirely (it existed only
    to issue signed upload URLs for the now-defunct manual banner-bake flow;
    no callers in `src/`).
  - Imports trimmed: `crypto`, `MEDIA_BUCKET`, `parseBannerConfig`,
    `renderBannerForContent`, `resetBannerStateForContent`, `resolveBannerLabel`,
    `createServiceSupabaseClient` are gone.
  - The `approveSchema` Zod object lost its banner-payload fields (only
    `contentId` is accepted now — matching what the UI actually sends).
- `src/lib/create/service.ts` — replaced legacy banner pre-render + state with
  a per-campaign banner override write to the new columns. `bannerConfigFromDefaults`,
  `resolveBannerLabel`, and `renderBannerForContent` imports are gone;
  `BANNER_COLOUR_HEX` is the only remaining banner-config import.
- `src/features/create/generated-content-review-list.tsx` — dropped the
  approval-time `renderPlannerContentBanner` call. Banners are now rendered at
  publish time, so the UI no longer needs to bake them on approve.
- `src/lib/link-in-bio/public.ts` — migrated from `parseBannerConfig` on
  `prompt_context` to the new override columns + `posting_defaults`. Selects
  the variant override columns, resolves via `bannerConfigResolver`, computes
  the label, and attaches the resolved `ResolvedConfig` + label to the public
  card. The legacy `BannerColourId` round-trip is gone — hex is written
  directly to the card payload.
- `src/lib/link-in-bio/types.ts` — `PublicCampaignCard` now exposes
  `bannerConfig?: ResolvedConfig | null` + `bannerLabel?: string | null`
  instead of the four legacy fields; the `BannerColourId` / `BannerPosition`
  types are no longer needed here.
- `src/features/link-in-bio/public/link-in-bio-public-page.tsx` — removed the
  `buildResolvedConfig()` adapter and the `BANNER_COLOUR_HEX` import. Reads
  `campaign.bannerConfig` directly.

## Commits

```
37522f5 refactor(publish): preflight banner render in publish worker        (Task 11)
cb6033d feat: drop legacy banner state columns                              (Task 12)
2e80b60 chore(banner): remove dead code after consistency rework            (Task 13)
0ec6b7b chore(banner): clean up materialise-weekly legacy banner caller     (Task 13 follow-up)
```

The materialise-weekly follow-up is split out of the Task 13 bundle because
the file lives under `supabase/functions/` (different concern from the `src/`
deletions) and was caught by the post-cleanup self-check grep, not the initial
file list in the brief. Splitting it kept the Task 13 commit focused on what
the plan listed.

## Format

TS/SQL.

## CI verify

`npm run ci:verify` result: **pass** (lint zero warnings, typecheck clean,
all 577 tests pass, build succeeds). The build step requires `NEXT_PUBLIC_*`
env vars — copied `.env.local` from the parent worktree directory for the
local run; the file was deleted after verification and is not committed.

## Migration 2 apply status

**Skipped** — local Supabase isn't linked in this worktree (`npx supabase db
push --dry-run` errored with "Cannot find project ref"). Wave 1 hit the same
situation with Migration 1; the migration file is the deliverable. The
operator will run `npx supabase db push` against the linked project at
deploy time.

## Function audit result

**No rows.** Ran the audit query from `.claude/rules/supabase.md` against the
`cheersai2.0` project (id `nbkjciurhvkfpcpatbnt`) via the supabase MCP. No
public functions or triggers reference `banner_state`, `banner_label`,
`bannered_media_path`, `banner_rendered_for_scheduled_at`,
`banner_render_metadata`, or `banner_source_media_path`. Migration 2 contains
only column drops — no `CREATE OR REPLACE FUNCTION` blocks needed. The
migration file documents this in a header comment.

## Issues

- **Deno deployment caveat.** The plan's Task 11 specified inline imports of
  `@/lib/banner/render-server` (Sharp) into the publish-queue worker. The
  worker is deployed as a Supabase edge function (Deno runtime) and Sharp
  doesn't have a Deno build. Implemented as the plan specified — Vitest tests
  pass via the `@`-alias and the Next.js build excludes `supabase/` from its
  tsconfig — but the production edge deployment will need a runtime change
  (run the publish queue from a Node host, or replace Sharp with a Deno-
  compatible image library) before this code path executes. The plan author
  has approved the design call; flagging here for visibility.
- **`supabase/functions/publish-queue/proximity.ts` does not exist in this
  branch.** The brief lists this file as Wave 3's responsibility to "sync
  with `src/lib/scheduling/proximity-label.ts`". I checked carefully:
  `find supabase/functions/publish-queue -type f` shows only `index.ts`,
  `metadata.ts`, `worker.ts`, and the providers folder. The Wave-1 label-
  engine handoff also mentioned the file as a stale reference inside the
  comment at the top of `src/lib/scheduling/proximity-label.ts`, and the
  Wave-2 handoff repeated it. There is no duplicated proximity logic in
  `supabase/functions/publish-queue/` to keep in sync; my new worker imports
  `getProximityLabel` from `src/lib/scheduling/proximity-label.ts` directly
  (same `@`-alias caveat as Sharp above), so there is a single source of
  truth in this branch. I left the comment in `proximity-label.ts` alone
  to avoid a stale-comment churn commit; an editor can drop it later.
- **Workspace-rule constraints.** The brief explicitly forbids applying
  Migration 2 against any non-local Supabase project; only the local apply
  was attempted (and skipped because of the missing link). The migration
  file is committed and ready for the operator.
- **Wave-2 architecture-doc churn.** `docs/architecture/*.md` had unstaged
  edits when this wave started. Left untouched.

## Final state notes

- The branch is green: `npm run ci:verify` passes locally.
- Migration 1 + Migration 2 are both committed; the operator applies them at
  deploy time. Migration 1 (already on disk) added the new columns; Migration
  2 (this wave) drops the legacy columns. Order of application: Migration 1,
  ship the new code, Migration 2, then run the cleanup ops script.
- The cleanup ops script `scripts/ops/cleanup-banner-storage.ts` (Wave 1
  output) is run by the operator after Migration 2 ships and after the new
  publish worker has had a chance to upload at least one round of fresh
  banner JPEGs under `banners/{contentId}/{variantId}.jpg`.
- The orchestration plan is complete.

## Self-check

- [x] `git log -10` shows four new commits since Wave 2's last commit
      (`e2d3ed1`): `37522f5`, `cb6033d`, `2e80b60`, `0ec6b7b`. The brief
      called for three; the fourth is the materialise-weekly follow-up
      explained above.
- [x] `grep -rn "banner-canvas\|banner-renderer\.server\|banner-rendered-preview\|banner-overlay-preview\|repair-banner-overlays\|/api/internal/render-banner\|prompt_context.*bannerConfig" src/ supabase/ scripts/ package.json` →
      only matches in `supabase/migrations/20260507100000_banner_overlay_add_columns.sql`
      (Migration 1 — copies legacy `prompt_context.bannerConfig` keys, must
      reference the legacy names) and one prose comment in
      `scripts/ops/cleanup-banner-storage.ts`.
- [x] `grep -rn "renderBannerForContent\|resetBannerStateForContent\|renderPlannerContentBanner" src/` → zero matches.
- [x] `npm run ci:verify` clean.
- [x] `supabase/migrations/20260507100100_banner_overlay_drop_columns.sql`
      exists. Apply step skipped — noted above.
- [x] No legacy preview components imported anywhere.
- [x] Handoff written.
