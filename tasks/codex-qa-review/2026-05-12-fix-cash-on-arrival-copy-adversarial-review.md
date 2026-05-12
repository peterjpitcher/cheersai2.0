# Adversarial Review: Fix cash-on-arrival copy generation

**Date:** 2026-05-12
**Mode:** B (Code Review)
**Scope:** `src/lib/campaigns/generate.ts`, `src/lib/campaigns/generate.test.ts`
**Pack:** `tasks/codex-qa-review/2026-05-12-fix-cash-on-arrival-copy-review-pack.md`
**Reviewers:** Assumption Breaker, Workflow & Failure-Path

## Executive Summary

Fix addresses AI prompt unreliability for cash-on-arrival events by elevating the payment rule in the system prompt, adding a prominent user-prompt warning, implementing a single-retry correction mechanism, and de-duplicating error messages. The blocking finding (both reviewers converged) was that the correction retry could return a structurally altered payload. This has been fixed by overlaying only copy text from the correction onto the original validated payload.

## What Appears Solid

- Payment reassurance promoted from buried copy-rule to mandatory section at top of system prompt
- Cash-on-arrival flag computed once and reused for both prompt and validation (no drift)
- Correction pass re-validates and falls back to error on failure (no silent bypass)
- De-duplication of error messages improves UX without weakening validation

## Critical Risks (RESOLVED)

### AB-001 / WF-001: Correction retry bypassed structural constraints
**Status:** FIXED

The correction retry originally returned the raw AI response after only checking ad set count and copy validation. A correction response could have altered targeting, objectives, CTAs, or dropped fields. Fixed by overlaying only `headline`, `primary_text`, and `description` from the correction response onto the original validated payload, preserving all structural fields.

## Implementation Defects (RESOLVED)

### AB-003 / WF-002: Missing retry mechanism tests
**Status:** FIXED

Added 5 tests for `attemptCopyCorrection`: successful correction, structural preservation (verifies tampered fields are rejected), still-failing correction returns null, null content returns null, wrong ad set count returns null.

## Unproven Assumptions

### AB-002: Cash-on-arrival detection from free-text brief
Cash-on-arrival enforcement only triggers via `sourceSnapshot.paymentMode` or `managementPrompt` pattern match. If a user types "pay on arrival" in the free-text brief without importing from the management app, the validation and prompt warning are skipped. This is a separate concern from the reported bug (which involves imported events) and should be tracked as a separate enhancement.

## Minor Observations

- AB-004: Architecture doc counts are slightly inconsistent (session-setup artefact, not related to this fix)

## Recommended Fix Order

All fixes have been applied in this session.
