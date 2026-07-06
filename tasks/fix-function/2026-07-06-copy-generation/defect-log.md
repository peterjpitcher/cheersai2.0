# Defect Log — Copy Generation Pipeline (2026-07-06)

Base commit: 7c5b38d

## FF-001 — Banned-phrase blank-deletion breaks sentences (reported symptom)
- **Type**: Bug | **Severity**: Critical | **Confidence**: High
- **Evidence**: `src/lib/ai/postprocess.ts` `processPlatformBody` deletes every `config.bannedPhrases` match with `replace(pattern, '')`. `BANNED_PHRASES` (voice.ts) includes "a night to remember", so "Bring your friends and family for a night to remember. Book now!" → "Bring your friends and family for. Book now!" (the screenshot symptom).
- **Root cause**: v2 pipeline never uses `BANNED_PHRASE_REPLACEMENTS`; phrase-only deletion always risks broken grammar.
- **Sibling check**: same blank-deletion in v1 `postProcessGeneratedCopy` (topics + user phrases), `sanitiseCountdownLanguage` (countdown phrases), and `scrubBannedPhrases`'s empty replacement for "you won't regret it".
- **Fix**: replacement-first scrub (`scrubBannedPhrases`), then remove the whole containing sentence for any banned phrase left; fall back to phrase deletion only if that would empty the copy.
- **Bucket**: Safe fix. **Acceptance**: unit tests for replaced phrase, removed sentence, empty-body fallback.

## FF-002 — v2 system prompt never bans the system cliché list
- **Type**: Bug | **Severity**: High | **Confidence**: High
- **Evidence**: `buildSystemPrompt` (prompts.ts:447-457) only lists `brand.bannedPhrases`; v1 `buildInstantPostPrompt` merges `BANNED_PHRASES`. The model freely writes clichés which FF-001 then mangles.
- **Fix**: include `mergedBannedPhrases(brand?.bannedPhrases ?? [])` in the v2 system prompt (also when no brand row exists).
- **Bucket**: Safe fix. **Acceptance**: prompt contains "a night to remember" in the never-use list.

## FF-003 — Duplicate "Book now" CTA survives when attached to a longer line
- **Type**: Bug | **Severity**: High | **Confidence**: High
- **Evidence**: `stripBareBookingCtaLines` only removes standalone lines ≤6 words. "…for a night to remember. Book now!" is one long line → bare CTA kept → composer appends "Book now: {url}" → double CTA (visible in screenshot).
- **Sibling check**: Instagram — bare "Book now!" in body + appended "Link in bio to book." line duplicates the same way; not handled at all.
- **Fix**: also strip a trailing bare booking-CTA *sentence* from the final body line; apply the same strip to Instagram when a link-in-bio line will be appended.
- **Bucket**: Safe fix. **Acceptance**: unit tests both platforms; keep-CTA-when-nothing-replaces-it behaviour retained.

## FF-004 — Apostrophe mismatch in banned-phrase matching
- **Type**: Bug | **Severity**: Medium | **Confidence**: High
- **Evidence**: replacement pattern `/\byou won[‘’]t regret it\b/` matches curly only; list entry "you won't regret it" is straight — straight variant fell through to blank-deletion (orphan full stop). Its replacement was `""` — blank-deletion by another name.
- **Fix**: normalise curly→straight apostrophes when matching banned phrases/topics; drop the empty-replacement entry (sentence removal owns it in both paths).
- **Bucket**: Safe fix. **Acceptance**: both apostrophe variants removed cleanly.

## FF-005 — Word-limit truncation destroys paragraph breaks
- **Type**: Bug | **Severity**: Medium | **Confidence**: High
- **Evidence**: `truncateAtSentenceBoundary` does `split(/\s+/).join(' ')` — any body over the word limit loses all line breaks (Instagram formatting relies on them).
- **Fix**: slice the original string at the word cutoff so newlines survive.
- **Bucket**: Safe fix. **Acceptance**: truncated body retains `\n\n`.

## FF-006 — Emoji clamp breaks ZWJ emoji sequences
- **Type**: Bug | **Severity**: Low | **Confidence**: High
- **Evidence**: `EMOJI_REGEX = /\p{Extended_Pictographic}/gu` counts/removes per codepoint — clamping a 👨‍👩‍👧 family emoji leaves orphaned zero-width joiners / partial emoji.
- **Fix**: match full emoji sequences (modifiers, VS-16, ZWJ chains) as one unit.
- **Bucket**: Safe fix. **Acceptance**: no `‍` orphans after clamping.

## FF-007 — Prompt contradicts its own banned list ("atmosphere")
- **Type**: UX gap | **Severity**: Medium | **Confidence**: High
- **Evidence**: `PUB_WRITING_RULES` says "Lead with why it'll be a good time — the fun, the atmosphere, the reason to come" while "atmosphere" is a banned phrase that gets scrubbed — the prompt steers the model into text the post-process then rewrites/mangles.
- **Fix**: reword the rule; with FF-001, "atmosphere" now maps to "vibe" via replacement instead of deletion.
- **Bucket**: Safe fix.

## FF-008 — v2 prompt lacks engagement-driving guidance
- **Type**: UX gap | **Severity**: Medium | **Confidence**: Medium
- **Evidence**: v1 Facebook guidance includes "close with a question or opinion prompt that invites comments"; v2 `PLATFORM_RULES`/`PUB_WRITING_RULES` have no engagement guidance (user's explicit ask: engagement-driving content).
- **Fix**: add concise rules — hook-first opener, no formulaic openers, Facebook comment-inviting question.
- **Bucket**: Safe fix.

## FF-009 — v1 pipeline blank-deletes user banned topics/phrases + countdown language
- **Type**: Bug (sibling of FF-001) | **Severity**: Medium | **Confidence**: High
- **Evidence**: `postProcessGeneratedCopy` uses `scrubBannedTopics` (phrase deletion) for topics and phrases; `sanitiseCountdownLanguage` deletes countdown phrases mid-sentence ("Last chance to book!" → " to book!").
- **Fix**: sentence-level removal in both, with the empty-body fallback; `applyChannelRules` also sentence-removes leftover system banned phrases after the replacement scrub.
- **Bucket**: Safe fix.

## Out of scope / noted
- Cross-post repetition within a campaign (e.g. "Food is served from 4pm" in every post) — needs generation-time awareness of sibling posts; parked as a follow-up feature.
- Model hallucination of specifics (e.g. band-name typos) — mitigated by existing accuracy guardrails; not deterministically fixable.
