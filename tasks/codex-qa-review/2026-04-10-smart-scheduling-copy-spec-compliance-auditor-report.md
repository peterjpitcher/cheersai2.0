**Requirements Coverage Matrix**

| ID | Assumption Checked | Code Reference | Status |
|---|---|---|---|
| R001 | Spec document path exists | [spec.md:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/docs/superpowers/specs/2026-04-10-smart-scheduling-and-copy-improvements-design.md#L1) | Confirmed |
| R002 | All 8 referenced code files exist | [prompts.ts:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/prompts.ts#L1), [voice.ts:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/voice.ts#L1), [content-rules.ts:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/content-rules.ts#L1), [service.ts:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L1), [schema.ts:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/schema.ts#L1), [conflicts.ts:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/scheduling/conflicts.ts#L1), [materialise.ts:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/scheduling/materialise.ts#L1), [data.ts:1](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/settings/data.ts#L1) | Confirmed |
| R003 | `buildPlatformGuidance()` exists | [prompts.ts:76](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/prompts.ts#L76) | Confirmed |
| R004 | `buildContextBlock()` exists | [prompts.ts:253](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/prompts.ts#L253) | Confirmed |
| R005 | `describeEventTimingCue()` exists | [service.ts:290](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L290) | Confirmed |
| R006 | `resolveConflicts()` exists | [conflicts.ts:15](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/scheduling/conflicts.ts#L15) | Confirmed |
| R007 | `materialiseRecurringCampaigns()` exists | [materialise.ts:17](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/scheduling/materialise.ts#L17) | Confirmed |
| R008 | Stories are excluded from main conflict logic | [service.ts:201](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L201), [content-rules.ts:171](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/content-rules.ts#L171) | Confirmed |
| R009 | Scheduling is a shared campaign-metadata contract today | [schema.ts:319](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/schema.ts#L319), [schema.ts:396](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/schema.ts#L396), [schema.ts:480](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/schema.ts#L480) | Deviated |
| R010 | Existing “fixed-day cadence” is the current weekly model | [schema.ts:480](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/schema.ts#L480), [service.ts:760](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L760) | Partial |
| R011 | `CampaignScheduleMetadata` matches current metadata shape | [service.ts:605](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L605), [service.ts:737](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L737), [service.ts:888](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L888) | Deviated |
| R012 | `src/lib/create/schema.ts` is the only input surface that needs changing | [actions.ts:145](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/(app)/create/actions.ts#L145), [weekly-campaign-form.tsx:401](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/create/weekly-campaign-form.tsx#L401), [suggestion-utils.ts:47](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/create/schedule/suggestion-utils.ts#L47) | Deviated |
| R013 | Current generation interfaces can fetch recent hooks/pillars | [service.ts:1037](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L1037), [service.ts:1172](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L1172) | Deviated |
| R014 | DB-only history lookups can vary posts within the same generation batch | [service.ts:944](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L944), [service.ts:980](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L980) | Deviated |
| R015 | Adding nullable `hook_strategy` / `content_pillar` to `content_items` is additive-compatible | [20250203120000_initial.sql:89](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/supabase/migrations/20250203120000_initial.sql#L89) | Confirmed |
| R016 | `BrandProfile` currently owns posting-time/location settings | [data.ts:5](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/settings/data.ts#L5), [data.ts:18](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/settings/data.ts#L18) | Deviated |
| R017 | Only `settings/data.ts` needs changes for new settings fields | [settings/schema.ts:3](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/settings/schema.ts#L3), [settings/actions.ts:30](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/(app)/settings/actions.ts#L30), [settings/actions.ts:121](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/(app)/settings/actions.ts#L121), [20250203120000_initial.sql:12](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/supabase/migrations/20250203120000_initial.sql#L12) | Deviated |
| R018 | `conflicts.ts` / `materialise.ts` are the only live scheduling surfaces | [service.ts:192](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L192), [campaign-materialiser/index.ts:19](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/supabase/functions/campaign-materialiser/index.ts#L19), [worker.ts:132](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/supabase/functions/materialise-weekly/worker.ts#L132) | Deviated |
| R019 | Prompt changes are isolated to `prompts.ts` / `service.ts` | [postprocess.ts:116](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/postprocess.ts#L116), [generate-stream/route.ts:109](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/api/create/generate-stream/route.ts#L109), [preflight.ts:225](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/publishing/preflight.ts#L225) | Partial |
| R020 | Downstream readers are unaffected by new scheduling/copy semantics | [weekly-campaign-form.tsx:612](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/create/weekly-campaign-form.tsx#L612), [link-in-bio/public.ts:247](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/link-in-bio/public.ts#L247), [planner/data.ts:629](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/planner/data.ts#L629) | Partial |

### SPEC-001: The spec assumes a shared scheduling model that the codebase does not have
- **Spec Reference:** Part 1 “Campaign Scheduling Modes”, “Schema Changes”, “UI Changes”
- **Requirement:** Add generic `scheduleMode`, `postsPerWeek`, `staggerPlatforms` to campaign metadata/input; existing behaviour is `fixed_days`
- **Code Reference:** [schema.ts:319](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/schema.ts#L319), [schema.ts:480](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/schema.ts#L480), [service.ts:760](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L760), [service.ts:888](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L888)
- **Status:** Deviated
- **Severity:** Critical
- **Description:** Scheduling is per-campaign-type today. Weekly uses top-level `dayOfWeek` / `time` / `weeksAhead` / `customSchedule`; event uses `scheduleOffsets` / `customSchedule`; promotion uses its own custom schedule model. There is no existing shared `CampaignScheduleMetadata`.
- **Impact:** Implementing the spec literally will touch the wrong abstraction and leave real entrypoints inconsistent.
- **Suggested Resolution:** Scope the feature to weekly campaigns first, or define explicit per-campaign schema/UI/service changes instead of a fictional shared metadata contract.

### SPEC-002: Hook rotation and pillar nudging cannot work as specified in the current batch-generation flow
- **Spec Reference:** Part 2 “Selection Logic”; Part 3 “Prompt Nudge”
- **Requirement:** Read recent `content_items` history during generation and vary consecutive posts
- **Code Reference:** [service.ts:944](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L944), [service.ts:1037](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L1037), [service.ts:1172](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L1172)
- **Status:** Deviated
- **Severity:** Critical
- **Description:** Variants are generated before any `content_items` rows are inserted, and generation does not receive `accountId` or `supabase`. A DB lookup can only see old posts, not earlier posts in the same batch.
- **Impact:** Multi-post campaigns can still repeat the same hook or angle, so success criteria 3 and 6 can fail immediately.
- **Suggested Resolution:** Carry account/history context into generation and maintain in-memory recent hook/pillar state across the batch, then persist the chosen values on insert.

### SPEC-003: The settings changes are mapped to the wrong model and the migration plan is incomplete
- **Spec Reference:** Part 1 “Time Selection”; Part 1 “Schema Changes”; “Files Affected”; “Migration & Rollback”
- **Requirement:** Add `defaultPostingTime` and `venueLocation` to `BrandProfile`; only `settings/data.ts` is called out
- **Code Reference:** [data.ts:5](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/settings/data.ts#L5), [data.ts:18](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/settings/data.ts#L18), [settings/schema.ts:18](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/settings/schema.ts#L18), [settings/actions.ts:121](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/(app)/settings/actions.ts#L121), [20250203120000_initial.sql:12](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/supabase/migrations/20250203120000_initial.sql#L12)
- **Status:** Deviated
- **Severity:** High
- **Description:** The app already separates brand voice settings from posting defaults. `BrandProfile` is voice-oriented; scheduling defaults live under `PostingDefaults` / `posting_defaults`. The spec also omits the SQL, settings schema, settings action, and settings UI changes needed to store the new fields.
- **Impact:** A literal implementation will put scheduling data in the wrong place or compile against fields that do not exist.
- **Suggested Resolution:** Decide the owning model explicitly, add the required SQL migration, and update settings schema/actions/forms with that decision.

### SPEC-004: The spec names non-authoritative scheduling files and misses active production workers
- **Spec Reference:** Part 1 “Time Selection”; “Files Affected”; “Files NOT Affected”
- **Requirement:** `conflicts.ts` stays unchanged; recurring scheduling work lives in `materialise.ts`
- **Code Reference:** [service.ts:192](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/create/service.ts#L192), [conflicts.ts:15](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/scheduling/conflicts.ts#L15), [materialise.ts:17](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/scheduling/materialise.ts#L17), [campaign-materialiser/index.ts:19](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/supabase/functions/campaign-materialiser/index.ts#L19), [worker.ts:132](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/supabase/functions/materialise-weekly/worker.ts#L132)
- **Status:** Deviated
- **Severity:** High
- **Description:** The main create flow uses a separate `resolveScheduleConflicts()` inside `service.ts`. There are also multiple weekly materialisation paths outside the listed files.
- **Impact:** Updating only the files named in the spec can leave live scheduling paths on old behaviour and create split-brain scheduling.
- **Suggested Resolution:** Identify one authoritative conflict resolver and one authoritative weekly materialiser, then update all live entrypoints or remove duplicates first.

### SPEC-005: The prompt pipeline is broader than the spec describes, and publish-time validation depends on `prompt_context`
- **Spec Reference:** Part 4 “No Other Changes”; Part 5 “Implementation”
- **Requirement:** Prompt changes are effectively contained to prompt building; no other pipeline impact
- **Code Reference:** [prompts.ts:30](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/prompts.ts#L30), [postprocess.ts:116](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/postprocess.ts#L116), [content-rules.ts:154](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/ai/content-rules.ts#L154), [generate-stream/route.ts:109](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/app/api/create/generate-stream/route.ts#L109), [preflight.ts:225](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/publishing/preflight.ts#L225)
- **Status:** Partial
- **Severity:** High
- **Description:** Prompt text is previewed through a separate streaming route, then post-processed, channel-ruled, linted, and later revalidated from `content_items.prompt_context` at publish time. New columns alone will not affect publish readiness.
- **Impact:** Preview, saved content, and publish-time validation can diverge, and new metadata may be invisible to the runtime checks that matter.
- **Suggested Resolution:** Document the full pipeline and decide which new values must also be written into `prompt_context`, not only into new DB columns.

### SPEC-006: Several downstream readers already encode timing/platform assumptions the spec does not mention
- **Spec Reference:** Part 1 “Platform Staggering”; “UI Changes”; “Migration & Rollback”
- **Requirement:** Spread-evenly/staggering is additive and isolated to creation/materialisation
- **Code Reference:** [weekly-campaign-form.tsx:612](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/create/weekly-campaign-form.tsx#L612), [suggestion-utils.ts:47](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/create/schedule/suggestion-utils.ts#L47), [link-in-bio/public.ts:247](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/link-in-bio/public.ts#L247), [link-in-bio/public.ts:289](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/link-in-bio/public.ts#L289), [planner/data.ts:629](/Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/lib/planner/data.ts#L629)
- **Status:** Partial
- **Severity:** Medium
- **Description:** The weekly UI already has auto-vs-manual calendar semantics, link-in-bio derives timing labels from `prompt_context.slot` and ranks same-day platforms, and planner readers only surface `scheduled_for` plus raw `prompt_context`.
- **Impact:** New staggered semantics can render incorrectly or stay invisible even if generation itself works.
- **Suggested Resolution:** Add the weekly schedule UI, link-in-bio reader, and planner read models to the implementation plan, or explicitly accept those surfaces staying unchanged.

Main takeaways: all referenced files and named existing functions are present, but the spec’s biggest mismatches are the assumed shared scheduling model, the missing same-batch history plumbing for hook/pillar logic, the wrong ownership for new settings fields, and several unlisted live dependencies outside the reviewed file list.