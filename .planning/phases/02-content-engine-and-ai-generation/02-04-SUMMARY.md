---
phase: 02-content-engine-and-ai-generation
plan: 04
subsystem: ui
tags: [react-hook-form, zod, framer-motion, radix-dialog, radix-sheet, responsive-design, wizard]

# Dependency graph
requires:
  - phase: 02-01
    provides: ContentType, DraftState, PlatformCopy types
  - phase: 02-02
    provides: useBreakpoint hook, design system tokens
  - phase: 02-03
    provides: content-schemas, content server actions, auto-save hook
provides:
  - 4-step create wizard (Brief, Generate, Media, Schedule)
  - Responsive container (bottom sheet / slide-over / modal)
  - 5 type-specific form field components
  - Draft auto-save on step transitions
  - Draft resume via URL query param
affects: [02-05-ai-generation-pipeline, 02-06-media-library, 02-07-scheduling]

# Tech tracking
tech-stack:
  added: []
  patterns: [responsive-container-pattern, wizard-step-pattern, discriminated-union-form]

key-files:
  created:
    - src/features/create/create-flow-container.tsx
    - src/features/create/steps/brief-step.tsx
    - src/features/create/steps/generate-step.tsx
    - src/features/create/steps/media-step.tsx
    - src/features/create/steps/schedule-step.tsx
    - src/features/create/forms/instant-post-fields.tsx
    - src/features/create/forms/story-fields.tsx
    - src/features/create/forms/event-fields.tsx
    - src/features/create/forms/promotion-fields.tsx
    - src/features/create/forms/weekly-recurring-fields.tsx
  modified:
    - src/features/create/create-wizard.tsx
    - src/features/create/create-page-client.tsx
    - src/features/create/create-modal.tsx
    - src/app/(app)/create/page.tsx
    - src/features/create/schemas/content-schemas.ts

key-decisions:
  - "ContentBriefInput type added for Zod discriminated union + React Hook Form compatibility"
  - "FieldValues generic used for form field components to avoid complex discriminated union type threading"
  - "Tasks 1 and 2 merged into single commit due to circular type dependency (steps needed for wizard typecheck)"

patterns-established:
  - "Responsive container pattern: useBreakpoint -> Sheet(bottom)/Sheet(right)/Dialog by breakpoint"
  - "Wizard step pattern: AnimatePresence with directional slide, step indicator bar"
  - "Form field components use FieldValues generic for compatibility with discriminated union parent form"

requirements-completed: [UX-03, UX-10, CONT-06]

# Metrics
duration: 8min
completed: 2026-05-19
---

# Phase 02 Plan 04: Create Wizard UI Summary

**4-step create wizard with responsive container, 5 content type forms, auto-save, and draft resume via React Hook Form + Zod + Framer Motion**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-19T09:31:57Z
- **Completed:** 2026-05-19T09:40:18Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments
- CreateFlowContainer renders bottom sheet on mobile, slide-over on tablet, modal on desktop (UX-03)
- CreateWizard manages 4-step flow with React Hook Form + Zod validation, auto-save on step transitions (D-03), AnimatePresence step animations (D-10)
- All 5 content type form field components with proper accessibility (fieldset/legend, aria attributes)
- BriefStep with type picker grid, common fields, platform selection, progressive disclosure fine-tune controls (D-04)
- GenerateStep with platform columns, modifier chips, loading skeletons (ready for Plan 05 wiring)
- ScheduleStep with summary card, datetime picker, Europe/London timezone note
- Create page route supports draft resume via ?draft=uuid query param

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Create flow container, wizard, forms, steps, and page route** - `34c7d53` (feat)

**Plan metadata:** pending (docs: complete plan)

_Note: Tasks 1 and 2 were merged into a single commit because the wizard (Task 1) requires step components (Task 2) for TypeScript compilation._

## Files Created/Modified
- `src/features/create/create-flow-container.tsx` - Responsive container (Sheet/Dialog by breakpoint)
- `src/features/create/create-wizard.tsx` - 4-step wizard with RHF+Zod, auto-save, draft resume
- `src/features/create/steps/brief-step.tsx` - Type picker, common fields, platform selection, fine-tune controls
- `src/features/create/steps/generate-step.tsx` - Platform columns, modifier chips, loading state
- `src/features/create/steps/media-step.tsx` - Media grid placeholder, Open Library button
- `src/features/create/steps/schedule-step.tsx` - Summary card, schedule picker, confirm button
- `src/features/create/forms/instant-post-fields.tsx` - Publish mode toggle, datetime picker
- `src/features/create/forms/story-fields.tsx` - Platform restriction note
- `src/features/create/forms/event-fields.tsx` - Event name, date, time, venue fields
- `src/features/create/forms/promotion-fields.tsx` - Offer summary with char counter, coupon, dates
- `src/features/create/forms/weekly-recurring-fields.tsx` - Day selector, time, weeks-ahead slider
- `src/features/create/create-page-client.tsx` - Client shell wrapping wizard in flow container
- `src/features/create/create-modal.tsx` - Updated legacy modal to use new wizard interface
- `src/app/(app)/create/page.tsx` - Server route with draft query param support
- `src/features/create/schemas/content-schemas.ts` - Added ContentBriefInput type

## Decisions Made
- Used `ContentBriefInput` (z.input) type for React Hook Form because Zod discriminated unions with `.default()` fields produce different input vs output types, causing resolver type conflicts
- Form field components accept `FieldValues` generic rather than specific schema types to avoid complex discriminated union type threading through component tree
- Combined Tasks 1 and 2 into a single commit because the wizard component imports step components directly -- TypeScript compilation requires both to exist simultaneously

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated CreateModal to new wizard interface**
- **Found during:** Task 1
- **Issue:** Existing create-modal.tsx referenced old CreateWizard props (mediaAssets, plannerItems, etc.) causing type errors
- **Fix:** Updated CreateModal to use new simplified wizard props (onClose only)
- **Files modified:** src/features/create/create-modal.tsx
- **Verification:** npx tsc --noEmit passes
- **Committed in:** 34c7d53

**2. [Rule 3 - Blocking] Added ContentBriefInput type for Zod/RHF compatibility**
- **Found during:** Task 1
- **Issue:** Zod discriminated union with .default() fields produces different input vs output types, causing zodResolver type mismatch
- **Fix:** Added z.input type export and used eslint-disable for resolver cast
- **Files modified:** src/features/create/schemas/content-schemas.ts, src/features/create/create-wizard.tsx
- **Verification:** npx tsc --noEmit passes
- **Committed in:** 34c7d53

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the type compatibility issues documented as deviations.

## Known Stubs
- **GenerateStep onGenerate/onRegenerate:** Empty callback placeholders -- wired in Plan 05
- **MediaStep "Open Library" button:** Empty onClick -- wired in Plan 06
- **ScheduleStep conflict detection:** Placeholder text -- wired in Plan 07
- **ScheduleStep onConfirm:** Saves draft and closes -- full publish pipeline wired in Plan 07

All stubs are intentional and documented in the plan as shells for future plan wiring.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wizard UI structure complete and ready for AI generation wiring (Plan 05)
- GenerateStep accepts callbacks for generation and regeneration with modifier chips
- MediaStep accepts selectedMediaIds and onMediaChange for library integration (Plan 06)
- ScheduleStep ready for conflict detection and publish pipeline (Plan 07)

---
*Phase: 02-content-engine-and-ai-generation*
*Completed: 2026-05-19*
