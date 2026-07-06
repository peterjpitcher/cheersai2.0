# Remediation Plan — Copy Generation (2026-07-06)

- [x] voice.ts: drop empty-replacement entry for "you won't regret it" (FF-004)
- [x] postprocess.ts: add apostrophe-normalising sentence-removal helper (FF-001/004/009)
- [x] postprocess.ts: processPlatformBody → replacement scrub first, then sentence removal (FF-001)
- [x] postprocess.ts: strip trailing bare booking CTA sentence; apply to Instagram too (FF-003)
- [x] postprocess.ts: newline-preserving truncation (FF-005)
- [x] postprocess.ts: emoji-sequence-aware clamping (FF-006)
- [x] postprocess.ts: v1 postProcessGeneratedCopy + countdown → sentence removal (FF-009)
- [x] content-rules.ts: sentence-remove leftover system banned phrases in applyChannelRules (FF-009)
- [x] content-rules.ts: stripDisallowedClaims → sentence removal (pass-2 sibling)
- [x] prompts.ts: merged banned phrases in v2 system prompt (FF-002)
- [x] prompts.ts: fix "atmosphere" contradiction + engagement rules (FF-007/008)
- [x] tests: 10 new tests in postprocess.test.ts covering all fixed behaviours
- [x] verification: lint ✓ typecheck ✓ tests 1624 passed ✓ build ✓
- [x] second + third discovery passes (pass 3 clean)

## Not done / follow-ups (out of scope)
- Cross-post repetition within a campaign (same "Food served from 4pm" line in every post) — needs sibling-post awareness at generation time.
- Streaming preview shows raw pre-process text (persisted drafts are processed) — cosmetic.
