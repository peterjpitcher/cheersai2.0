---
phase: 02-content-engine-and-ai-generation
plan: 05
subsystem: ai
tags: [openai, zod, structured-outputs, prompt-engineering, brand-voice, postprocessing]

requires:
  - phase: 02-01
    provides: Content types, PlatformCopy interface, ContentItem types
  - phase: 02-03
    provides: ContentBrief Zod schemas, content-schemas discriminated union
provides:
  - generatePlatformCopy function with OpenAI structured outputs
  - buildSystemPrompt and buildUserPrompt v2 prompt builders
  - postprocessCopy multi-platform pipeline (banned phrases, emoji/hashtag clamping, word limits)
  - TONE_PROFILES and BrandVoiceConfig for brand voice system
  - TEMPERATURE_MAP for content-type x platform temperature tuning
  - generateContent and regenerateWithModifier server actions
  - AiGenerationResponseSchema Zod schema for structured output validation
affects: [02-04-wizard, 02-06-editor, 03-publishing-pipeline]

tech-stack:
  added: [openai@6.38.0 (upgraded from 6.15.0)]
  patterns: [zodResponseFormat structured outputs, .nullable() for OpenAI API fields, multi-platform postprocess pipeline]

key-files:
  created:
    - src/lib/ai/schemas.ts
    - src/lib/ai/generate.ts
    - src/lib/ai/temperature.ts
    - src/app/actions/ai-generate.ts
    - src/lib/ai/generate.test.ts
    - src/lib/ai/postprocess.test.ts
  modified:
    - src/lib/ai/voice.ts
    - src/lib/ai/prompts.ts
    - src/lib/ai/postprocess.ts
    - package.json

key-decisions:
  - "OpenAI schema uses .nullable() not .optional() -- API rejects optional fields in structured outputs"
  - "v2 AI modules added alongside v1 exports to preserve backward compatibility with existing service.ts"

patterns-established:
  - "OpenAI structured outputs: use zodResponseFormat with flat Zod schemas (no unions), all fields .nullable()"
  - "Multi-platform generation: single call returns all 3 platforms, postprocess applied per-platform"
  - "Brand voice: TONE_PROFILES const + BrandVoiceConfig interface loaded from profiles table at generation time"

requirements-completed: [AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, AI-07, AI-08, AI-09]

duration: 5min
completed: 2026-05-19
---

# Phase 02 Plan 05: AI Generation Engine Summary

**OpenAI structured outputs with Zod validation, multi-platform prompt building, brand voice system, and post-processing pipeline with 30s timeout**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-19T09:31:51Z
- **Completed:** 2026-05-19T09:37:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Complete AI generation pipeline: single brief produces Facebook, Instagram, and GBP copy via OpenAI structured outputs
- Post-processing pipeline: banned phrase stripping, emoji/hashtag clamping, word limit enforcement, GBP CTA lint warning
- Server actions for generate and regenerate-with-modifier with auth, brand voice loading, and error handling
- 12 passing tests covering postprocess pipeline (8) and generate function (4)

## Task Commits

Each task was committed atomically:

1. **Task 1: AI schemas, prompts, voice, post-processing, and temperature config** - `008f2de` (feat)
2. **Task 2: AI generation function and server actions** - `6053231` (feat)

## Files Created/Modified
- `src/lib/ai/schemas.ts` - AiGenerationResponseSchema with .nullable() fields for OpenAI structured outputs
- `src/lib/ai/generate.ts` - Core generatePlatformCopy with zodResponseFormat and 30s AbortController timeout
- `src/lib/ai/temperature.ts` - TEMPERATURE_MAP per content-type x platform
- `src/lib/ai/prompts.ts` - Added buildSystemPrompt and buildUserPrompt v2 functions
- `src/lib/ai/voice.ts` - Added TONE_PROFILES, BrandVoiceConfig, buildVoiceInstructions
- `src/lib/ai/postprocess.ts` - Added postprocessCopy multi-platform pipeline
- `src/app/actions/ai-generate.ts` - generateContent and regenerateWithModifier server actions
- `src/lib/ai/generate.test.ts` - 4 tests: parse, timeout, null response, empty choices
- `src/lib/ai/postprocess.test.ts` - 8 tests: banned phrases, hashtags, emojis, word limit, signatures, CTA warnings
- `package.json` - OpenAI SDK upgraded to 6.38.0

## Decisions Made
- OpenAI structured outputs require `.nullable()` not `.optional()` -- the API rejects optional fields. Schema updated to use `.nullable()` with all fields required.
- v2 AI modules (TONE_PROFILES, buildSystemPrompt, buildUserPrompt, postprocessCopy) added alongside existing v1 exports to preserve backward compatibility with `src/lib/create/service.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed schema to use .nullable() instead of .optional()**
- **Found during:** Task 2 (generate function tests)
- **Issue:** OpenAI structured outputs API rejects Zod schemas with `.optional()` fields -- requires `.nullable()` with all fields present
- **Fix:** Changed all optional fields in AiGenerationResponseSchema to `.nullable()`, updated postprocess clampArray to handle null
- **Files modified:** src/lib/ai/schemas.ts, src/lib/ai/postprocess.ts, src/lib/ai/postprocess.test.ts
- **Verification:** All 12 tests pass
- **Committed in:** 6053231 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for OpenAI API compatibility. No scope creep.

## Issues Encountered
None beyond the schema fix documented above.

## User Setup Required
None - no external service configuration required. OPENAI_API_KEY already exists in env.ts.

## Next Phase Readiness
- AI generation engine ready for wizard integration (Plan 04 Generate step)
- Server actions ready for UI consumption: generateContent and regenerateWithModifier
- Post-processing pipeline ready for editor preview (Plan 06)

---
*Phase: 02-content-engine-and-ai-generation*
*Completed: 2026-05-19*
