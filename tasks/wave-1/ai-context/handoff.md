# AI Context Agent -- Handoff

## What was done

### `src/app/actions/ai-generate.ts`
- Added `slotLabel?: string` to `GenerationContextInput` interface
- `generateContent`: forwards `slotLabel` to `buildUserPrompt` via context object
- `generateContent`: stores `slotLabel` in `ai_generation_params.generationContext`
- `regenerateWithModifier`: forwards `slotLabel` to `buildUserPrompt` via context object
- `regenerateWithModifier`: stores `slotLabel` in `ai_generation_params.generationContext`

### `src/lib/ai/prompts.ts`
- Added `slotLabel?: string` to `buildUserPrompt`'s context parameter type
- Added slot purpose line after the schedule time section:
  `Slot purpose: "{label}" -- write copy that fits this narrative moment.`
- Line only renders when `slotLabel` is present (backwards compatible)

## Backwards compatibility
- All changes are additive; `slotLabel` is optional everywhere
- Existing single-slot generation (no slotLabel) produces identical output
- `buildInstantPostPrompt` (v1) was not modified

## Assumptions
- The slot purpose line is placed after the schedule time block and before the media metadata block in the user prompt. This ordering gives the AI schedule context first, then narrative context, then visual context.
- The wording "write copy that fits this narrative moment" is intentionally open-ended so it works for any label (event day, countdown, launch, weekly series, etc.)

## Issues
- Three pre-existing TypeScript errors exist in `create-wizard.tsx` and `schedule-step.tsx` (owned by other agents). These are unrelated to this change.

## Self-check
- [x] slotLabel added to GenerationContextInput
- [x] slotLabel forwarded in generateContent
- [x] slotLabel forwarded in regenerateWithModifier
- [x] buildUserPrompt renders slot purpose line
- [x] ai_generation_params includes slotLabel (both actions)
- [x] No modifications outside owned files
- [x] Backwards compatible
- [x] TypeScript clean in owned files
