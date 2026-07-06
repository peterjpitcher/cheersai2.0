# FF-016 — Trailing at/via/on word-eating (fixed 2026-07-06)

## Root cause
`stripDirectLinks` (social-links.ts) and `cleanCopyArtifacts` (copy-rules.ts) both ran two
unconditional trims — `\b(?:at|via|on)\s*([.!?])` and `\b(?:at|via|on)$` — meant to tidy a
preposition left dangling after a URL was removed. Because they ran on all copy (cleanCopyArtifacts
runs on every publish body + CTA; content-rules called stripDirectLinks unconditionally), they ate
legitimate sentence-final words: "the match is on" -> "the match is", "come and see what we're on"
-> "...we're", "pull up a chair at" -> "pull up a chair". Also, the `$`-anchored trim rarely did its
intended job anyway (a trailing space after the removed URL blocked it), so it left "book now at"
dangling while still harming clean copy.

## Fix (root-cause, tighter than the reported suggestion)
- Folded the preposition removal INTO the link removal: `DIRECT_LINK_WITH_LEADING_PREPOSITION`
  optionally consumes an immediately-preceding "at/via/on " together with the link. The preposition
  is stripped only when a real link follows it; copy that merely ends in on/at/via is untouched.
  This also fixes the latent "book now at" dangling-preposition case.
- Removed both unconditional preposition trims from `cleanCopyArtifacts` (it must not do
  link-adjacent cleanup — it runs on every body and CTA).
- Guarded the unconditional `stripDirectLinks` call in content-rules.ts with `containsDirectLink`
  (also avoids a false "urls_removed" repair on link-free copy).

## Tests
- New src/lib/utils/social-links.test.ts (13 tests) and src/lib/publishing/copy-rules.test.ts
  (7 tests) — no test files existed for these utilities before.
- Cover: link removal (URL, bare domain, preposition+link), sentence stripping, and the regression
  cases (legit trailing/mid-sentence on/at/via preserved).

## Verification
lint ✓ · typecheck ✓ · tests 1649 passed / 2 skipped (+18) ✓ · build ✓

## Still deferred
FF-017 (bare-domain regex blanking sentences at period-no-space, social-links.ts:2) — separate task
chip task_34ef89df, higher-risk regex change with false-negative risk on real domains.
