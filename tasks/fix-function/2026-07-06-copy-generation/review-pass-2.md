# Adversarial Pre-Merge Review — Pass 2 (2026-07-06)

11 reviewers over the diff + blast radius; every finding adversarially verified by re-running the real code. 11 raw findings, 10 survived (1 rejected). Fixed 6 in-scope; deferred 2 pre-existing shared-utility bugs; 2 no-action.

## Fixed in this changeset

| # | Sev | File | Issue | Fix |
|---|-----|------|-------|-----|
| FF-010 | High | postprocess.ts | Empty-body fallback in `removeBannedPhraseSentences` was apostrophe-sensitive → leaked banned phrase for curly apostrophes | `buildBannedTopicPattern` now collapses apostrophe variants to a class (fixes fallback + all callers) |
| FF-011 | High | postprocess.ts | Instagram bare CTA not stripped when model omits `link_in_bio_line` but a link is configured → duplicate CTA | Gate the strip on the composer's CTA condition (`hasInstagramLink`), mirroring Facebook |
| FF-012 | Med | postprocess.ts | Configured signature defeated trailing-CTA strip (strip only saw the last line = signature) | Moved the bare-CTA strip inside `processPlatformBody`, before the signature append |
| FF-013 | Med | postprocess.ts | `BARE_BOOKING_CTA_LINE` didn't match CTAs ending in skin-tone/ZWJ/keycap emoji → duplicate CTA | Extended the trailing char class to include `\p{Emoji_Modifier}`, ZWJ, keycap |
| FF-014 | Med | content-rules.ts | Link-in-bio phrase deleted mid-sentence on Facebook ("Find the to book.") | Sentence-level removal via `removeSentencesMatching` (sibling of the original bug) |
| FF-015 | Med | content-rules.ts | `stripDisallowedClaims` fallback re-introduced broken fragments (", so book early.") when claim was the whole body | New `cleanClaimFragment` strips the orphaned leading connective/punctuation |

FF-011 and FF-012 fixed together by one refactor: the bare-CTA strip now happens inside `processPlatformBody` (pre-signature), gated per platform on whether the composer will append a CTA (FB: cta_text or link; IG: configured link).

## Deferred — pre-existing, shared utility (`social-links.ts`), separate follow-ups (task chips spawned)

| # | Sev | File | Issue | Why deferred |
|---|-----|------|-------|--------------|
| FF-016 | Med (verified) | social-links.ts / copy-rules.ts `cleanCopyArtifacts` | Trailing `at/via/on` remover eats legitimate final words ("the match is on" → "the match is") | Shared utility on every publish path; needs its own guarded fix + tests; not introduced/worsened by this change |
| FF-017 | High (verified, non-blocker) | social-links.ts | Bare-domain regex matches `word.Word` (period, no space) → can blank whole body | Regex change with false-negative risk on real domains; pre-existing, out of this diff |

## No action (verified, not real defects)
- CTA-only body → empty string: arguably correct (composer adds the linked CTA); the suggested "restore body" fix would re-create the duplicate CTA. Left as-is.
- "you won't regret it" dropped from `detectBannedPhrases` preflight lint: conscious trade-off — generation still strips it via `removeBannedPhraseSentences`; only affects manually re-edited stored copy with a curly apostrophe.

## Verification (pass 2)
lint ✓ · typecheck ✓ · tests 1631 passed / 2 skipped ✓ · build ✓ · working tree = 6 intended files + 1 new test file.
