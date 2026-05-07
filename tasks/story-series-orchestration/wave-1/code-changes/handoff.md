# Wave 1 / Code changes — Handoff

## Outputs
- 5 commits, one per task (Tasks 2-6)
- All ownership-listed files modified or deleted as appropriate
- `src/features/create/story-series-form.tsx` deleted
- `tests/app/create/actions.test.ts` deleted (entirely story-series scope)
- Placement multi-select wired into event and promotion forms with default `["feed"]`
- Stories tab removed from create wizard

## Commits
- `bdfb2d0` Task 6: chore(create): remove Stories tab from create wizard
- `33159a9` Task 5: feat(create): add placement multi-select to promotion campaigns
- `7f182ee` Task 4: feat(create): add placement multi-select to event campaigns
- `a1999f4` Task 3: refactor(create): remove createStorySeries and related schemas
- `3769b37` Task 2: refactor(scheduling): drop story_series from CampaignTiming

(Sibling agent's Task 1 migration commit at `8fff2d6` precedes these.)

## Format
TypeScript code + Vitest tests.

## CI verify

| Step | Status | Detail |
|---|---|---|
| `npm run lint:ci` | PASS | Zero warnings/errors. |
| `npm run typecheck` | PRE-EXISTING FAIL (2 errors) | Both errors are in `supabase/functions/publish-queue/banner-label.ts` and `supabase/functions/publish-queue/worker.ts` for `Cannot find module 'https://esm.sh/luxon@3.7.2'`. Verified pre-existing on branch tip `8fff2d6` (before any of my Task 2-6 commits). My changes introduce **zero** new typecheck errors. The Deno-style URL import was added in commit `5712e3f` ("fix(publish-queue): use https://esm.sh URL for luxon import") which exists on this branch only — not on main. |
| `npm run test:ci` | PASS | 81 test files, 628 tests passing. |
| `npm run build` | PASS | Production build succeeds, all routes generated. |

The pre-existing typecheck errors block `npm run ci:verify` from completing because the script chains `lint:ci && typecheck && test:ci && build`. Lint, tests, and build all pass when run individually.

## Surprises / scope expansions

1. **Pre-existing typecheck failures on Deno files.** The branch `claude/loving-antonelli-8797d7` already had failing typecheck on `supabase/functions/publish-queue/banner-label.ts` and `worker.ts` before I started — caused by the URL-style luxon import (`https://esm.sh/luxon@3.7.2`) that resolves at Deno runtime but trips Node `tsc --noEmit`. Verified by checking out `8fff2d6` and running typecheck. No action taken (out of scope).

2. **`tests/app/create/actions.test.ts` was entirely story-series scope.** Per Task 3 step 4 the plan said to "Delete or update story-series-specific test cases. Keep tests that exercise other campaign types unchanged." The file's only `describe` block was for story series, so the file was deleted entirely with `git rm`. No other campaign-type tests were lost.

3. **`resolveStoryScheduledFor` import in `src/lib/create/service.ts` became orphan after deleting `createStorySeries`.** Removed the import (`@/lib/create/story-schedule`) — `resolveStoryScheduledFor` is still used by `handleInstantPostSubmission` in `src/app/(app)/create/actions.ts` so the source module stays.

4. **Plan's "build stays green at every commit" claim is incorrect.** The plan's self-review states "Tasks 2 and 3 only delete dead branches" so build stays green. In reality, `src/features/create/story-series-form.tsx` actively imports `handleStorySeriesSubmission`, `storySeriesFormSchema`, and `StorySeriesFormValues`. Once Task 3 deletes those exports, `story-series-form.tsx` has 4 typecheck errors that persist through Tasks 4 and 5. Task 6 deletes the form, restoring green typecheck (modulo the pre-existing Deno errors above). I followed the plan strictly rather than reordering — each commit's dedicated `npx vitest run <touched-dirs>` and `npm run lint` stayed green throughout.

5. **No story_series references found outside the plan's listed files.** Confirmed by `grep -rn "story_series\|StorySeries\|story-series\|storySeries" src/ supabase/ tests/` — only matches are inside `supabase/migrations/` (the new migration plus the two pre-existing history migrations the plan calls out).

## Verification (post-Task 6)

```
$ grep -rn "story_series\|StorySeries\|story-series\|storySeries" src/ supabase/ tests/
supabase/migrations/20260507130000_drop_story_series_campaign_type.sql:1:-- Drop story_series campaign type. ...
supabase/migrations/20260507130000_drop_story_series_campaign_type.sql:3:-- ... story_series ...
supabase/migrations/20260507130000_drop_story_series_campaign_type.sql:6:-- ... drop-story-series-design.md
supabase/migrations/20260507130000_drop_story_series_campaign_type.sql:11: WHERE campaign_type = 'story_series';
supabase/migrations/20260507130000_drop_story_series_campaign_type.sql:13:-- Replace the CHECK constraint to remove story_series.
supabase/migrations/20251021143000_update_campaign_type_check.sql:6:    check (campaign_type in ('event','promotion','weekly','instant','story_series'));
supabase/migrations/20250203120000_initial.sql:76:  campaign_type text not null check (campaign_type in (..., 'story_series')),
```

All matches are inside `supabase/migrations/` — exactly what the plan specifies.

## Downstream notes
- Migration is owned by the sibling agent and applied later by the orchestrator.
- The Vercel auto-deploy will pick up the route action / form changes when main is pushed.
- The publish-queue Edge Function needs to be redeployed because `supabase/functions/publish-queue/banner-label.ts` changed (orchestrator's job).
- The pre-existing typecheck failure on the Deno files is independent of this work and should be tracked as separate tech debt — likely needs a `supabase/functions/tsconfig.json` or to revert commit `5712e3f`'s URL-style import.
