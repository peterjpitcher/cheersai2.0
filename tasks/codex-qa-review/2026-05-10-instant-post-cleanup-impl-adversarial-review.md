# Adversarial Review (Stage 2 — Implementation): instant-post cleanup

**Date:** 2026-05-10
**Mode:** B (Code Review)
**Scope:** 5 commits ahead of `74c9308` — schema + tests + service + route + form
**Pack:** `tasks/codex-qa-review/2026-05-10-instant-post-cleanup-impl-review-pack.md` (127 KB)
**Reviewers run:** Assumption Breaker, Workflow & Failure-Path
**Reviewers skipped:** Integration & Architecture (already done at spec stage), Security (no auth surface), Performance (UI/single-call cost), Standards (not asked)

## Executive Summary

**Both reviewers returned a single non-blocking finding each.** Implementation matches the spec; both bugs are demonstrably fixed with regression coverage. No repair agents required.

## What Both Reviewers Endorsed

- Story placements skip both `getOpenAIClient()` and `responses.stream()`, with `done` event still emitted after persistence.
- Instant posts now always pass an explicit `bannerOverride` carrying `banner_enabled: true | false` (never NULL) into the shared persistence helper.
- Campaign behaviour is provably preserved — `computeBannerOverride` and the existing `bannerDefaults` path are untouched; campaign callers still write NULL banner columns and inherit account defaults at publish time.
- Test coverage spans: story OpenAI bypass, lazy-init guard, feed regression, banner_enabled write contracts, and the campaign regression guard.
- Route still authenticates the Supabase user before streaming.
- Form's AbortController path correctly cancels in-flight streams on unmount.

## Findings

### AB-001 — Banner UI shown for stories: do banners actually render on stories? (Medium, non-blocking, not actually a defect)

Reviewer flagged because the publish-queue/render code wasn't in the pack. **Confirmed at session level:** banners DO render on stories. The session's earlier Jessica Lovelock incident — a story published with a banner reading "TODAY" — was the exact bug that motivated this whole change. Story-derivative path in `resolveAndRenderBanner` writes `banners/{contentId}/{variantId}.jpg` regardless of placement. Reviewer's caution was warranted given the pack scope, but the answer is "yes, story banners work". No action.

### WF-001 — Banner state outside React Hook Form (Medium, non-blocking, polish)

Banner state is held in component state via `useState`, not in RHF's defaults. If the user enables the banner, submits, the request fails, and they refresh/navigate before retrying, the banner choice resets to `enabled: false`. They could silently retry without the banner.

**Reviewer marked non-blocking.** Reasoning aligns:
- Other form fields don't persist across refresh either (the form has no draft-restore mechanism).
- In-place retry (without remount) preserves the banner state via React.
- The failure mode requires page refresh during a failed submit — unusual.

**Recommendation: ship as-is, log as polish.** Moving banner into RHF would be ~10 lines but would be inconsistent with how the rest of the form models its multi-stage state.

## No Findings In These Categories

- OpenAI calls remaining on the story preview branch — none.
- RLS / auth regression — none; route still authenticates first.
- Campaign-flow inheritance regression — none; provably preserved by the test fixture.
- Material test gap for the Bug A/B contracts — none.
- Double-submit regression — none; AbortController already handles it.

## Recommended Next Steps

None blocking. Ready to push.

Optional polish for a future ticket:
1. Move `banner` into RHF defaults so it survives refresh (WF-001).
2. Add a draft-restore mechanism for the entire form so multi-stage flows survive accidental navigation.

## Reviewer Output Files

- `ipc-impl-assumption-breaker-findings.json` — 1 finding (non-blocking, false alarm)
- `ipc-impl-workflow-findings.json` — 1 finding (non-blocking, polish)
