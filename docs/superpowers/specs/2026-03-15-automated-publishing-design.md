# Automated Publishing — Design Spec

## Goal

Replace the two-step "Save Draft → Publish" flow with a single "Save & Publish" button that immediately pushes the campaign to Meta Ads Manager. Ad set phase dates are normalised to midnight so phase-specific copy language is always temporally correct.

---

## Background

Currently the user fills the campaign brief form, saves a draft, lands on a campaign detail page, and manually clicks a separate "Publish" button. The user wants one action: fill form → click "Save & Publish" → campaign is live in Meta.

---

## Scope

**In scope:**
- New `saveAndPublishCampaign` server action combining save + publish
- Midnight normalisation of `phase_start` / `phase_end` in `calculatePhases()`
- `publish_error TEXT NULL` column on `meta_campaigns`
- UI: rename button, loading state, error display, retry button
- Partial-failure resume in `publishCampaign` (skip already-published objects on retry)
- Tests for all of the above

**Out of scope:**
- Background job / queue-based publishing
- Scheduling campaigns for future publish dates
- Campaign editing after publish

---

## Architecture

### Flow

```
User clicks "Save & Publish"
  → saveAndPublishCampaign(payload, meta)
      → saveCampaignDraft()          # saves campaign as DRAFT, returns campaignId
                                     # auth re-verified inside saveCampaignDraft via requireAuthContext()
      → publishCampaign(campaignId)  # calls Meta API inline
          success → status = ACTIVE, publish_error = null
          failure → saveAndPublishCampaign writes publish_error to DB,
                    returns { campaignId } so UI can redirect and show error
  → redirect to /campaigns/[id]
```

### Server action: `saveAndPublishCampaign`

New action in `src/app/(app)/campaigns/actions.ts`:

```typescript
export async function saveAndPublishCampaign(
  payload: AiCampaignPayload,
  meta: SaveCampaignMeta,
): Promise<{ campaignId: string } | { error: string }>
```

1. Auth is re-verified server-side inside `saveCampaignDraft` via the existing `requireAuthContext()` call — `saveAndPublishCampaign` does not need to re-check separately.
2. Calls `saveCampaignDraft(payload, meta)` — on error, returns `{ error }` immediately (nothing to roll back).
3. Calls `publishCampaign(campaignId)`:
   - On success: `publishCampaign` internally sets `status = ACTIVE` and `publish_error = null` in the DB.
   - On failure: `saveAndPublishCampaign` catches the error, writes `publish_error = <message>` to `meta_campaigns`, and returns `{ campaignId }` so the UI redirects and shows the error.
   - `publish_error` is owned by `saveAndPublishCampaign` on failure and by `publishCampaign` on success (where it sets it to `null`). This avoids overlapping DB responsibilities — each path has one writer.
4. Returns `{ campaignId }` in all cases where the save succeeded (regardless of publish outcome).

The `CampaignBriefForm` redirects to `/campaigns/[id]` in all non-fatal cases (campaign was saved), only showing a top-level error toast if the save itself failed.

### Midnight normalisation in `calculatePhases()`

`src/lib/campaigns/phases.ts` currently returns `phase_start` / `phase_end` as ISO date strings. After this change, all phase boundary dates are forced to local midnight (Europe/London), then stored as UTC ISO strings:

- Input dates (`startDate`, `endDate`) are treated as calendar dates only — time component is discarded.
- Each phase boundary is constructed as `YYYY-MM-DDT00:00:00` in Europe/London local time, then converted to UTC ISO string for storage. During BST (UTC+1), midnight London = 23:00 UTC the previous calendar day; during GMT (UTC+0), midnight London = 00:00 UTC the same calendar day. This is intentional — Meta receives the correct UTC timestamp corresponding to local midnight, ensuring ad copy language is evaluated at the day boundary in the UK.
- `ads_stop_time` (TIME field on Day Of ad set) is unchanged — it remains the user-supplied stop time for that specific ad.

### Partial-failure resume in `publishCampaign`

`src/app/(app)/campaigns/[id]/actions.ts` — `publishCampaign` already stores `meta_adset_id`, `meta_ad_id`, etc. as it goes. On retry, the action checks each object before creating it:

- If `meta_campaign_id` is already set → skip Meta campaign creation, use existing ID.
- If `meta_adset_id` is already set → skip Meta ad set creation, use existing ID.
- If `meta_ad_id` is already set → skip Meta ad creation, use existing ID.

On successful completion of a retry, `publishCampaign` sets `status = ACTIVE` and `publish_error = null`.

If a retry itself fails, `saveAndPublishCampaign` is not involved — the retry is triggered directly from the campaign detail page. The Retry button calls `publishCampaign(campaignId)` directly. On retry failure, `publish_error` is overwritten with the new error message (replacing the previous one). The status remains `DRAFT`.

---

## Database

### Migration

```sql
ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS publish_error TEXT;
```

Single column addition — no data loss risk, no RLS changes needed.

### Status semantics

| `status` | `publish_error` | Meaning |
|---|---|---|
| `DRAFT` | `NULL` | Just saved, never attempted publish |
| `DRAFT` | `<message>` | Publish attempted and failed (most recent error message) |
| `ACTIVE` | `NULL` | Live in Meta |
| `PAUSED` / `ARCHIVED` | — | Managed in Meta directly |

---

## UI Changes

### `CampaignBriefForm`

- Button label: "Save & Publish" (was "Save Draft")
- Loading label: "Publishing to Meta…"
- On `{ error }` from action: show inline error toast, stay on form (save failed)
- On `{ campaignId }`: redirect to `/campaigns/[campaignId]` (regardless of publish outcome — the campaign was saved)

### Campaign detail page (`/campaigns/[id]/page.tsx`)

- Shows `ACTIVE` badge when `status === 'ACTIVE'`
- Shows `DRAFT` badge + red error panel + "Retry" button when `status === 'DRAFT' && publish_error`
  - Error panel text: "Publishing failed: [publish_error]"
  - "Retry" button calls `publishCampaign(campaignId)` server action and revalidates the page
  - If the retry fails, `publish_error` is updated with the new error message and the error panel remains visible
- `PublishButton` component removed — no longer needed as a separate UI element
- Any existing tests for `PublishButton` are deleted alongside the component

### Error classification (for user-facing messages)

| Condition | Message |
|---|---|
| Meta token missing / expired | "Meta Ads account not connected or token expired. Please reconnect in Connections." |
| Meta API rejection | Meta's error message, verbatim |
| Partial failure mid-publish | "Publishing partially failed. Click Retry to continue from where it stopped." |

---

## Testing

### `saveAndPublishCampaign`

- Happy path: save + publish succeed → returns `{ campaignId }`, campaign `status` is `ACTIVE`, `publish_error` is `null`
- Publish failure: save succeeds, publish fails → returns `{ campaignId }`, `publish_error` is set in DB, status remains `DRAFT`
- Save failure: returns `{ error }` immediately, nothing written to DB

### `calculatePhases` midnight fix

- All `phase_start` and `phase_end` values in returned phases have a time component corresponding to midnight Europe/London (i.e. the UTC offset is correct for the season — BST or GMT)
- `ads_stop_time` is unaffected by the midnight normalisation

### `publishCampaign` partial-failure resume

- Mock Meta API to fail on ad set 2 of 3 → verify ad set 1 has `meta_adset_id` stored, ad set 3 has none
- On retry with ad set 1 already having `meta_adset_id` → verify Meta ad set creation is not called for ad set 1
- Full retry succeeds → all ad sets and ads have `meta_*_id` values, campaign `status` is `ACTIVE`, `publish_error` is `null`
- Retry itself fails → `publish_error` is overwritten with the new error, status remains `DRAFT`

### UI (manual testing only — no component tests required)

- Button label and loading state are verified visually during development
- Error panel and Retry button are verified against a campaign seeded with `status = DRAFT` and a non-null `publish_error`

---

## Files Touched

| File | Change |
|---|---|
| `supabase/migrations/20260315_add_publish_error.sql` | New — add `publish_error` column |
| `src/lib/campaigns/phases.ts` | Midnight normalisation |
| `src/app/(app)/campaigns/actions.ts` | New `saveAndPublishCampaign` action |
| `src/app/(app)/campaigns/[id]/actions.ts` | Partial-failure resume in `publishCampaign`; clear `publish_error` on success; overwrite on retry failure |
| `src/features/campaigns/CampaignBriefForm.tsx` | Button label, loading state, call new action |
| `src/app/(app)/campaigns/[id]/page.tsx` | Error panel, retry button, remove PublishButton import |
| `src/features/campaigns/PublishButton.tsx` | Delete |
| `tests/campaigns/phases.test.ts` | Midnight assertions |
| `tests/campaigns/campaign-actions.test.ts` | New action + resume + retry-failure tests |

---

## Non-Goals

- No rollback of the Meta campaign if DB update fails after publish (existing behaviour — logged for manual reconciliation)
- No UI for editing a campaign after it has been published
- No background queue — publish is synchronous in the server action
