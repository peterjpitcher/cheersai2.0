# Backend Engineer — Changes Log
## Phase 2: Campaign Publish Pipeline Fixes

Date: 2026-03-15

---

## Fix 1 — D2: `special_ad_categories` encoding (CRITICAL)

**File:** `src/lib/meta/marketing.ts`
**Function:** `createMetaCampaign`
**Lines changed:** ~150–162

**What changed:**
- Removed the `specialAdCategories` string variable that produced `'[]'` for NONE
- Replaced with a conditional body builder: when `specialAdCategory === 'NONE'`, the field is omitted entirely from the request body
- For non-NONE values, `special_ad_categories` is set to `JSON.stringify([specialAdCategory])` as before

**Decision:** Omitting the field for NONE is the safest fix. Meta v24.0 treats absence of `special_ad_categories` as "no restricted categories", which is the correct semantic for NONE. Sending `'[]'` URL-encoded was being parsed as a literal string by Meta, causing rejection.

---

## Fix 2 — D1: Add `billing_event` to `createMetaAdSet` (CRITICAL)

**File:** `src/lib/meta/marketing.ts`
**Function:** `createMetaAdSet`
**Lines changed:** ~182–191

**What changed:**
- Added `billing_event: 'IMPRESSIONS'` to the body object, between `optimization_goal` and `bid_strategy`

**Decision:** `IMPRESSIONS` is the standard value for most Meta campaign objectives. This is a required field per Meta API v24.0; its absence caused every ad set creation to fail silently (caught by the inner try/catch in actions.ts).

---

## Fix 3 — D4: Remove `message` from `link_data` in `createMetaAdCreative` (HIGH)

**File:** `src/lib/meta/marketing.ts`
**Function:** `createMetaAdCreative`
**Lines changed:** ~245–250

**What changed:**
- Removed `message` from the `linkData` object initialisation
- The `message` parameter is still accepted in the function signature (to avoid breaking the call site) but is no longer included in the API payload

**Decision:** Meta v24.0 deprecated `message` inside `link_data`. Removing it entirely is the safest fix — its absence does not cause a rejection (unlike `billing_event`). The `message` parameter was left in the interface signature to avoid cascading call-site changes outside scope.

---

## Fix 4 — D5: Guard against marking ACTIVE with zero Meta ad sets (HIGH)

**File:** `src/app/(app)/campaigns/[id]/actions.ts`
**Function:** `publishCampaign`
**Lines changed:** ~232 (counter init), ~260 (increment), ~358–368 (guard block)

**What changed:**
1. Added `let successfulAdSets = 0;` before the ad set loop
2. Added `successfulAdSets++;` immediately after `createdMetaObjects.push(metaAdSetId)` on successful ad set creation
3. Added a guard block after the loop (before the ACTIVE update): if `adSets.length > 0 && successfulAdSets === 0`, calls `setPublishError(...)` and returns `{ error: 'No ad sets published' }` instead of marking ACTIVE
4. If `adSets.length === 0` (no ad sets configured), still proceeds to ACTIVE — that is a data issue, not a publish failure

**Decision:** Previously, all ad set failures were silently swallowed by `continue`, leaving the campaign ACTIVE with zero live Meta ad sets. This guard ensures the campaign reflects its true state.

---

## Fix 5 — D7: Map Meta error messages to human-readable text (MEDIUM)

**File:** `src/app/(app)/campaigns/[id]/actions.ts`
**Lines changed:** ~64–78 (new function), ~381–383 (outer catch)

**What changed:**
1. Added `mapMetaErrorToUserMessage(message: string): string` function before `publishCampaign`, mapping:
   - "Invalid parameter" → configuration error message
   - "Error validating access token" / "access token" → token expiry message
   - "permission" → Business Manager access message
   - Anything else → returned as-is
2. In the outer `catch` block: raw error message now passed through `mapMetaErrorToUserMessage()` before being written to `publish_error` and returned to the caller

**Decision:** The mapper is intentionally conservative — unknown errors pass through unchanged rather than being replaced with a generic message, preserving debuggability for unexpected error types.

---

## Issues Encountered

None. All five fixes applied cleanly. The `message` parameter in `CreateAdCreativeParams` and the `message` argument at the call site in `actions.ts` were deliberately left untouched to keep changes minimal and avoid out-of-scope refactors.
