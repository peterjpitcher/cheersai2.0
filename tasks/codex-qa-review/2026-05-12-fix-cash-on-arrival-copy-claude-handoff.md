# Claude Hand-Off Brief: Fix cash-on-arrival copy generation

**Generated:** 2026-05-12
**Review mode:** B (Code Review)
**Overall risk:** Low (all blocking findings resolved)

## DO NOT REWRITE

- Payment reassurance mandatory section in SYSTEM_PROMPT (lines 68-70)
- Cash-on-arrival prompt warning block in user prompt (line 257)
- `hasCashOnArrivalContext()` detection logic (lines 466-472)
- `validateCampaignCopy()` validation rules (lines 144-230)
- Error de-duplication via `new Set()` (line 375)

## IMPLEMENTATION CHANGES APPLIED

- [x] AB-001/WF-001: `attemptCopyCorrection` now overlays only copy text (headline, primary_text, description) from AI correction onto original validated payload — all structural fields preserved
- [x] AB-003/WF-002: 5 new tests for `attemptCopyCorrection` covering success, structural preservation, failure fallback, null content, wrong ad set count

## ASSUMPTIONS TO RESOLVE (future work)

- [ ] AB-002: Cash-on-arrival from free-text brief — if a user types "pay on arrival" in the brief without importing an event, the validation is skipped. Track as separate enhancement if needed.

## REPO CONVENTIONS PRESERVED

- `AiCampaignPayload` type used consistently
- `validateCampaignCopy` called with same options pattern
- Test factories (`makeAd`, `makePayload`) follow project test patterns
- OpenAI mock uses `vi.fn().mockResolvedValue()` per project conventions

## RE-REVIEW REQUIRED AFTER FIXES

All findings resolved in this session. No re-review needed.
