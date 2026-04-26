# Standards Enforcement Report: Smart Scheduling & Copy Improvements

**Date:** 2026-04-10
**Spec:** `docs/superpowers/specs/2026-04-10-smart-scheduling-and-copy-improvements-design.md`
**Reviewer:** Standards Enforcement Specialist (automated)

---

## Spec-Level Findings

### STD-001: Spec uses camelCase for proposed DB column names in TypeScript interfaces but snake_case in SQL -- consistent
- **File:** Spec document (lines 91-98, 155-158, 197-199)
- **Severity:** Low
- **Standard:** Supabase conventions (`supabase.md`): DB columns are `snake_case`; TypeScript types are `camelCase`
- **Current code/spec:** The spec correctly uses `snake_case` in the SQL ALTER TABLE statements (`hook_strategy`, `content_pillar`) and `camelCase` in TypeScript interfaces (`scheduleMode`, `postsPerWeek`, `staggerPlatforms`). Campaign metadata is stored as a JSONB column, so the camelCase keys inside the JSON payload are a design choice rather than a DB column convention issue.
- **Expected:** This is compliant. No change needed.
- **Auto-fixable:** N/A

### STD-002: Spec does not describe auth checks for new scheduling functionality
- **File:** Spec document (entire document)
- **Severity:** High
- **Standard:** `definition-of-done.md`: "Auth checks in place -- server actions re-verify server-side"; `supabase.md`: "Server actions must always re-verify auth server-side"
- **Current code/spec:** The spec describes new scheduling logic (spread algorithm, platform staggering, time selection) and new prompt logic but does not mention auth/permission checks for the new campaign creation paths or the new `defaultPostingTime` / `venueLocation` settings fields.
- **Expected:** The spec should explicitly state that (1) the spread algorithm runs within the existing authenticated `createCampaignFromPlans` flow, (2) new brand settings fields are read/written through the existing `getOwnerSettings()` which calls `requireAuthContext()`, and (3) any new server actions re-verify auth. Without this, implementers may skip auth in new code paths.
- **Auto-fixable:** No

### STD-003: Spec testing strategy does not meet minimum coverage conventions
- **File:** Spec document (lines 310-318)
- **Severity:** Medium
- **Standard:** `testing.md`: "Minimum per feature: happy path + at least 1 error/edge case"; `definition-of-done.md`: "New tests written for business logic (happy path + at least 1 error case)"
- **Current code/spec:** The testing strategy lists happy-path scenarios (empty calendar, partially filled, etc.) but does not explicitly call out error/edge cases: invalid `postsPerWeek` values, missing `scheduleMode`, malformed `hook_strategy` values, pillar inference with empty title+prompt, or temporal proximity with invalid dates.
- **Expected:** Each test area should list at least one explicit error/edge case. For example: "Hook selection -- error case: corrupted hook_strategy values in DB", "Spread algorithm -- edge case: postsPerWeek exceeds 7", "Temporal proximity -- edge case: eventStart is null or invalid".
- **Auto-fixable:** No

### STD-004: Spec does not mention audit logging for new mutations
- **File:** Spec document (entire document)
- **Severity:** Medium
- **Standard:** `supabase.md`: "All mutations (create, update, delete) in server actions must call `logAuditEvent()`"
- **Current code/spec:** The spec introduces new data writes (storing `hook_strategy` and `content_pillar` on `content_items`, writing `defaultPostingTime` and `venueLocation` to brand settings) but does not mention audit logging for any of these.
- **Expected:** The spec should note that audit events are logged when new settings fields are saved and when hook_strategy/content_pillar are written to content_items (or note that these are set within the existing audited campaign creation flow).
- **Auto-fixable:** No

### STD-005: Spec proposes `venueLocation` on BrandProfile but no corresponding DB column or migration
- **File:** Spec document (lines 103-108)
- **Severity:** Medium
- **Standard:** `supabase.md`: "Migrations live in `supabase/migrations/`"; general schema change completeness
- **Current code/spec:** The spec adds `defaultPostingTime` and `venueLocation` to the TypeScript `BrandProfile` interface and mentions them in brand settings, but the "Schema Changes" section only covers the `content_items` table. There is no migration for adding these columns to the `brand_profile` or `posting_defaults` tables.
- **Expected:** The spec should include ALTER TABLE statements for the brand_profile or posting_defaults table to add `default_posting_time` and `venue_location` columns, or explicitly note these are stored in an existing JSONB metadata column.
- **Auto-fixable:** No

### STD-006: Spec does not mention rollback plan for schema changes
- **File:** Spec document (lines 299-309)
- **Severity:** Low
- **Standard:** `definition-of-done.md`: "Rollback plan documented for schema changes"
- **Current code/spec:** The Migration & Rollback section discusses feature-level rollback ("campaigns fall back to fixed_days") but does not provide a schema rollback plan (e.g., "DROP COLUMN hook_strategy" migration if needed).
- **Expected:** Include a reverse migration or note that the columns are nullable and can be dropped without data loss.
- **Auto-fixable:** No

### STD-007: Spec proposes `describeTemporalProximity` but existing `describeEventTimingCue` already covers similar logic
- **File:** Spec document (lines 246-269)
- **Severity:** Low
- **Standard:** Workspace CLAUDE.md: "Simplicity First -- make every change as simple as possible"
- **Current code/spec:** The spec proposes a new `describeTemporalProximity()` function with 6 brackets. The existing `describeEventTimingCue()` in `service.ts` (line 290) already computes temporal distance with 7 brackets. The spec acknowledges this ("we reuse that pattern") but proposes a parallel function rather than extending the existing one.
- **Expected:** The spec should clarify whether `describeTemporalProximity` replaces or wraps `describeEventTimingCue`, or explicitly justify having two parallel temporal distance functions.
- **Auto-fixable:** No

---

## Existing Code Findings

### STD-008: Exported functions in `voice.ts` lack explicit return types
- **File:** `src/lib/ai/voice.ts`:80, :93, :106
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md: "Explicit return types on all exported functions"
- **Current code/spec:** `export function scrubBannedPhrases(value: string) {`, `export function reduceHype(value: string) {`, `export function detectBannedPhrases(value: string) {` -- all lack explicit return types.
- **Expected:** `export function scrubBannedPhrases(value: string): { value: string; removed: string[] }`, etc.
- **Auto-fixable:** Yes

### STD-009: Exported function `buildInstantPostPrompt` in `prompts.ts` lacks explicit return type
- **File:** `src/lib/ai/prompts.ts`:30
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md: "Explicit return types on all exported functions"
- **Current code/spec:** `export function buildInstantPostPrompt({ brand, input, platform, scheduledFor, context, venueName }: PromptContext): PromptMessages {` -- this one actually does have a return type. However, reviewing the function signature more closely, it is correct. No finding here.
- **Expected:** N/A -- compliant.
- **Auto-fixable:** N/A

### STD-010: Exported function `resolveConflicts` in `conflicts.ts` has explicit return type -- compliant
- **File:** `src/lib/scheduling/conflicts.ts`:15
- **Severity:** N/A
- **Standard:** Workspace CLAUDE.md: "Explicit return types on all exported functions"
- **Current code/spec:** `export function resolveConflicts(slots: ScheduledSlot[]): ConflictResult[] {` -- compliant.
- **Expected:** N/A
- **Auto-fixable:** N/A

### STD-011: Exported functions in `service.ts` lack explicit return types
- **File:** `src/lib/create/service.ts`:395, :461, :510, :628, :760
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md: "Explicit return types on all exported functions"
- **Current code/spec:** All five exported campaign creation functions (`createInstantPost`, `createStorySeries`, `createEventCampaign`, `createPromotionCampaign`, `createWeeklyCampaign`) lack explicit return types.
- **Expected:** Each should declare its return type explicitly, e.g., `export async function createInstantPost(input: InstantPostInput): Promise<{ campaignId: string; ... }>`.
- **Auto-fixable:** Yes (with type inference tooling)

### STD-012: `materialiseRecurringCampaigns` lacks explicit return type
- **File:** `src/lib/scheduling/materialise.ts`:17
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md: "Explicit return types on all exported functions"
- **Current code/spec:** `export async function materialiseRecurringCampaigns(reference: Date = new Date()) {` -- no return type.
- **Expected:** `export async function materialiseRecurringCampaigns(reference: Date = new Date()): Promise<void> {`
- **Auto-fixable:** Yes

### STD-013: `console.debug` and `console.warn` statements in production code (`service.ts`)
- **File:** `src/lib/create/service.ts`:1049, :1201, :1217, :1231
- **Severity:** Low
- **Standard:** `definition-of-done.md`: "No console.log or debug statements left in production code"
- **Current code/spec:** Multiple `console.debug` calls exist, gated by `DEBUG_CONTENT_GENERATION` flag (line 24). One `console.warn` at line 1231 is unconditional. One `console.error` at line 1317 is for error logging which is acceptable.
- **Expected:** The `console.debug` calls are gated behind a debug flag, which is acceptable. The `console.warn` at line 1231 should either be removed or replaced with a structured logging mechanism. The unconditional warning about banned topics after scrub may be intentional for ops visibility but should be documented.
- **Auto-fixable:** No (requires judgement on whether to keep)

### STD-014: No test files exist for any of the reviewed modules
- **File:** `src/lib/ai/`, `src/lib/create/`, `src/lib/scheduling/`, `src/lib/settings/`
- **Severity:** High
- **Standard:** `testing.md`: "Minimum per feature: happy path + at least 1 error/edge case"; `definition-of-done.md`: "All existing tests pass / New tests written for business logic"
- **Current code/spec:** No `*.test.ts` files exist anywhere under `src/lib/`. The `content-rules.ts` file alone has ~800 lines of complex business logic (linting, channel rules, claim detection, day normalization) with zero test coverage. The scheduling modules (`conflicts.ts`, `materialise.ts`) contain algorithmic logic that is highly testable but untested.
- **Expected:** At minimum, the following should have test files: `content-rules.test.ts`, `voice.test.ts`, `prompts.test.ts`, `conflicts.test.ts`, `materialise.test.ts`. The spec proposes adding more complex logic (spread algorithm, hook selection, pillar inference) which will compound this gap.
- **Auto-fixable:** No

### STD-015: `settings/data.ts` does not use `fromDb` conversion helper
- **File:** `src/lib/settings/data.ts`:143-154
- **Severity:** Low
- **Standard:** `supabase.md`: "Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)"
- **Current code/spec:** The `getOwnerSettings()` function manually maps `snake_case` DB columns to `camelCase` TypeScript properties (e.g., `toneFormal: brandRow?.tone_formal`). This is done inline rather than through a shared `fromDb` helper.
- **Expected:** Use a `fromDb<BrandProfile>(brandRow)` conversion or equivalent shared utility. The manual mapping is functional but inconsistent with the convention and error-prone as fields are added.
- **Auto-fixable:** Yes

### STD-016: `materialise.ts` uses service-role client without documenting reason
- **File:** `src/lib/scheduling/materialise.ts`:18-19, :59-60
- **Severity:** Low
- **Standard:** `supabase.md`: "Service-role operations documented with comments: `// admin operation: [reason]`"
- **Current code/spec:** `tryCreateServiceSupabaseClient()` is called twice without the required comment explaining why the service-role client is needed.
- **Expected:** Add `// admin operation: materialise recurring campaigns across all accounts (cron job)` or similar comment.
- **Auto-fixable:** Yes

### STD-017: `materialise.ts` uses `OWNER_ACCOUNT_ID` constant, limiting to single-tenant
- **File:** `src/lib/scheduling/materialise.ts`:27, :93
- **Severity:** Low
- **Standard:** General architectural concern (not a strict convention violation)
- **Current code/spec:** The materialisation function hardcodes `OWNER_ACCOUNT_ID` for filtering campaigns and inserting content items. This is consistent with the current single-tenant design but worth noting as the spec proposes adding more scheduling complexity that will also be single-tenant bound.
- **Expected:** Acceptable for current single-tenant architecture. No change required unless multi-tenant is planned.
- **Auto-fixable:** No

### STD-018: `conflicts.ts` `findResolution` function has a logical issue
- **File:** `src/lib/scheduling/conflicts.ts`:50-65
- **Severity:** Low
- **Standard:** Code correctness / "No Laziness -- find root causes"
- **Current code/spec:** The `findResolution` function checks if a candidate time is within `RESOLUTION_WINDOW_MINUTES` of the conflict time, but since all offsets (15, 30, 45, 60, -15, -30, -45, -60 minutes) are already within the 120-minute window, the condition always passes. The function will always return the first offset (15 minutes after), making the loop over offsets pointless.
- **Expected:** The function should check whether the candidate time conflicts with *any* existing slot, not just whether it's within the resolution window. This appears to be a bug in the existing conflict resolution that the spec's changes will inherit.
- **Auto-fixable:** No (requires design decision)

### STD-019: Duplicated `formatFriendlyTime` function across `prompts.ts` and `service.ts`
- **File:** `src/lib/ai/prompts.ts`:321-331, `src/lib/create/service.ts`:119-130
- **Severity:** Low
- **Standard:** Workspace CLAUDE.md: "Simplicity First"; DRY principle
- **Current code/spec:** The `formatFriendlyTime` function is implemented identically in both files. The spec proposes adding more time-formatting logic to `service.ts`.
- **Expected:** Extract `formatFriendlyTime` into a shared utility (e.g., `src/lib/utils/date.ts` or `src/lib/dateUtils.ts` as referenced in the workspace CLAUDE.md conventions).
- **Auto-fixable:** Yes

### STD-020: `content-rules.ts` exports many functions without explicit return types
- **File:** `src/lib/ai/content-rules.ts`:108, :117, :154, :326, :469
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md: "Explicit return types on all exported functions"
- **Current code/spec:** `resolveAdvancedOptions`, `resolveContract`, `applyChannelRules`, `lintContent`, `removeTrailingEllipses` -- all exported functions. `resolveContract` and `applyChannelRules` and `lintContent` do have explicit return types (`:ContractResolution`, `:ChannelRuleResult`, `:LintResult`). `resolveAdvancedOptions` (line 108) and `removeTrailingEllipses` (line 469) do not.
- **Expected:** Add explicit return types: `resolveAdvancedOptions(...): InstantPostAdvancedOptions` and `removeTrailingEllipses(value: string): string`.
- **Auto-fixable:** Yes

### STD-021: `content-rules.ts` uses `as` type assertion without justification
- **File:** `src/lib/ai/content-rules.ts`:123
- **Severity:** Low
- **Standard:** Workspace CLAUDE.md: "No `any` types unless absolutely justified with a comment"
- **Current code/spec:** `context?.advanced as Partial<InstantPostAdvancedOptions>` -- uses `as` cast without comment. While not `any`, unsafe type assertions should be noted.
- **Expected:** Add a brief comment or use a runtime type guard instead: `// context.advanced is typed as unknown from the JSON payload`.
- **Auto-fixable:** Yes

### STD-022: Spec proposes new `BrandProfile` fields but existing `BrandProfile` interface has no `defaultPostingTime` or `venueLocation`
- **File:** `src/lib/settings/data.ts`:5-16 vs Spec document (lines 103-108)
- **Severity:** Medium
- **Standard:** Schema/type consistency
- **Current code/spec:** The existing `BrandProfile` interface has 10 fields. The spec proposes adding `defaultPostingTime` and `venueLocation`. The spec correctly shows these as optional fields. However, the `BrandProfileRow` type (line 40-51) and the `getOwnerSettings()` SELECT query (line 113-114) will also need updating, plus the `brand_profile` table needs the columns. The spec does not detail this full chain of changes.
- **Expected:** The spec should enumerate the full change chain: (1) DB migration to add columns, (2) update `BrandProfileRow` type, (3) update `BrandProfile` interface, (4) update SELECT query, (5) update mapping in `getOwnerSettings()`.
- **Auto-fixable:** No

---

## Summary

| Severity | Count | Auto-fixable |
|----------|-------|-------------|
| High     | 2     | 0           |
| Medium   | 7     | 3           |
| Low      | 9     | 4           |

### Critical Items (address before implementation)

1. **STD-002** (High): Spec must document auth check expectations for all new code paths.
2. **STD-014** (High): Zero test coverage exists for all affected modules. Adding the proposed features without first establishing baseline tests creates significant regression risk.

### Recommended Pre-Implementation Actions

1. Add test files for `conflicts.ts`, `materialise.ts`, `voice.ts`, and `content-rules.ts` before modifying them.
2. Add explicit return types to all exported functions in the affected files (STD-008, STD-011, STD-012, STD-020).
3. Extract the duplicated `formatFriendlyTime` into a shared date utility (STD-019).
4. Update the spec to include the full migration chain for `BrandProfile` fields (STD-005, STD-022).
5. Add auth check and audit logging expectations to the spec (STD-002, STD-004).
6. Review and fix the `findResolution` bug in `conflicts.ts` before adding spread algorithm logic on top (STD-018).
