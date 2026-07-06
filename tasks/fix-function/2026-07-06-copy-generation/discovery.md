# Discovery — Copy Generation Pipeline (2026-07-06)

Base commit: 7c5b38d. Symptom reported: generated Facebook copy reading "Bring your friends and family for. Book now!" plus generally sub-par engagement copy.

## Problem perimeter

Two live generation paths:

1. **v2 (Create wizard — the screenshot flow)**: `src/features/create/steps/generate-step.tsx` → `generateContent`/`regenerateWithModifier` (`src/app/actions/ai-generate.ts`) → `buildSystemPrompt`/`buildUserPrompt` (`src/lib/ai/prompts.ts`) → `generatePlatformCopy` (`src/lib/ai/generate.ts`, OpenAI structured outputs) → `postprocessCopy` (`src/lib/ai/postprocess.ts`) → composer `src/lib/publishing/compose-body.ts` appends CTA/hashtags at publish time.
2. **v1 (instant post / streaming)**: `src/app/api/create/generate-stream/route.ts` (raw preview stream) + `src/lib/create/service.ts` → `buildInstantPostPrompt` → `postProcessGeneratedCopy` → `finaliseCopy` → `applyChannelRules` (`src/lib/ai/content-rules.ts`).

Shared vocabulary lives in `src/lib/ai/voice.ts` (BANNED_PHRASES, BANNED_PHRASE_REPLACEMENTS, HYPE_REPLACEMENTS).

## Root cause of the reported symptom

`BANNED_PHRASES` includes clichés like "a night to remember". The v2 post-process deleted every banned phrase in place (`replace(pattern, '')`) without using the replacement map, so "…for a night to remember. Book now!" became "…for. Book now!". The v2 system prompt also never told the model to avoid the system cliché list (only the user's custom phrases), so the model produced those phrases constantly — every one of them then got mangled.

## Defect cluster (see defect-log.md)

Mid-sentence blank-deletion existed in five places: v2 banned phrases, v1 banned topics/phrases, v1 countdown language, v1 disallowed claims, and the empty-string replacement for "you won't regret it". CTA dedupe missed trailing "Book now!" sentences on longer lines (both platforms). Truncation destroyed paragraph breaks; emoji clamping broke ZWJ sequences; apostrophe style (curly vs straight) broke banned-phrase matching; the prompt contradicted its own banned list ("atmosphere") and lacked engagement guidance.

## Passes

- Pass 1: mapped perimeter, found FF-001…FF-009.
- Pass 2 (post-fix re-discovery): found `stripDisallowedClaims` sibling (fixed), confirmed `stripBlockedTokens` is correct as-is (template artefacts like "undefined"/"{{…}}" are inline tokens, not phrases), confirmed the streaming preview shows raw text but persisted drafts are fully post-processed (cosmetic only, noted).
- Pass 3: clean — remaining `replace(pattern, '')` sites are the intentional template-artefact stripper and the guarded empty-body fallback.
