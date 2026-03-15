# Automated Publishing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-step "Save Draft → Publish" flow with a single "Save & Publish" button that immediately publishes the campaign to Meta Ads Manager, with graceful error handling and a retry mechanism.

**Architecture:** A new `saveAndPublishCampaign` server action chains the existing `saveCampaignDraft` and `publishCampaign` actions. `publishCampaign` is extended to write `publish_error` on failure and clear it on success — this means both the initial publish and any retry share the same error-management logic. Ad set phase dates are normalised to midnight Europe/London when calling the Meta API via a new `toMidnightLondon` utility.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase PostgreSQL, Meta Graph API, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-15-automated-publishing-design.md`

---

## Implementation notes

### Midnight normalisation location
The spec places midnight normalisation in `calculatePhases()`, but `ad_sets.phase_start` / `phase_end` are Postgres `date` columns — they cannot store timestamps. The normalisation is therefore applied at the Meta API boundary inside `publishCampaign` using a new `src/lib/campaigns/time-utils.ts` utility. This produces the same outcome (Meta receives midnight UTC) without breaking DB storage. `phases.ts` is unchanged.

### `publish_error` ownership
The spec says `saveAndPublishCampaign` writes `publish_error` on failure, but the retry path (Retry button → `publishCampaign` directly) also needs to overwrite the error on failure. To avoid duplication, `publishCampaign` itself owns both the write (on failure) and the clear (on success). `saveAndPublishCampaign` does not need a separate write.

### `useToast` import
The project wraps Sonner in a custom hook at `@/components/providers/toast-provider`. This is the existing pattern (see `PublishButton.tsx`). Use `useToast()` and `toast.error('msg', { description: ... })` as already done in the codebase.

---

## File Map

| File | Action |
|------|--------|
| `supabase/migrations/20260315_add_publish_error.sql` | Create — add `publish_error` column |
| `src/types/campaigns.ts` | Modify — add `publishError` to `Campaign` interface |
| `src/app/(app)/campaigns/actions.ts` | Modify — add `publishError` to DB row + mapper; add `saveAndPublishCampaign` |
| `src/lib/campaigns/time-utils.ts` | Create — `toMidnightLondon` utility |
| `src/app/(app)/campaigns/[id]/actions.ts` | Modify — partial-failure resume; `publish_error` write on failure + clear on success; use `toMidnightLondon` |
| `src/features/campaigns/CampaignBriefForm.tsx` | Modify — button label + call `saveAndPublishCampaign` |
| `src/features/campaigns/CampaignActions.tsx` | Create — Retry + Pause buttons (replaces `PublishButton`) |
| `src/app/(app)/campaigns/[id]/page.tsx` | Modify — error panel, `CampaignActions`, remove `PublishButton` |
| `src/features/campaigns/PublishButton.tsx` | Delete |
| `tests/campaigns/phases.test.ts` | Modify — add `toMidnightLondon` tests |
| `tests/campaigns/campaign-actions.test.ts` | Create — `saveAndPublishCampaign` tests |

---

## Chunk 1: Database + Types

### Task 1: Database migration — add `publish_error` column

**Files:**
- Create: `supabase/migrations/20260315_add_publish_error.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260315_add_publish_error.sql
ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS publish_error TEXT;
```

- [ ] **Step 2: Apply the migration**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx supabase db push
```

Expected: `Applying migration 20260315_add_publish_error.sql...` with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260315_add_publish_error.sql
git commit -m "feat: add publish_error column to meta_campaigns"
```

---

### Task 2: Add `publishError` to Campaign type and mapper

**Files:**
- Modify: `src/types/campaigns.ts`
- Modify: `src/app/(app)/campaigns/actions.ts`

- [ ] **Step 1: Add `publishError` to the `Campaign` interface in `src/types/campaigns.ts`**

Find the `Campaign` interface (line 76) and add `publishError` after `metaStatus`:

```typescript
export interface Campaign {
  id: string;
  accountId: string;
  metaCampaignId: string | null;
  name: string;
  objective: CampaignObjective;
  problemBrief: string;
  aiRationale: string | null;
  budgetType: BudgetType;
  budgetAmount: number;
  startDate: string;
  endDate: string | null;
  status: CampaignStatus;
  metaStatus: string | null;
  publishError: string | null;   // ← add
  specialAdCategory: SpecialAdCategory;
  lastSyncedAt: Date | null;
  createdAt: Date;
  adSets?: AdSet[];
}
```

- [ ] **Step 2: Add `publish_error` to `CampaignDbRow` in `src/app/(app)/campaigns/actions.ts`**

Find `interface CampaignDbRow` and add after `meta_status`:

```typescript
interface CampaignDbRow {
  id: string;
  account_id: string;
  meta_campaign_id: string | null;
  name: string;
  objective: string;
  problem_brief: string;
  ai_rationale: string | null;
  budget_type: string;
  budget_amount: number;
  start_date: string;
  end_date: string | null;
  status: string;
  meta_status: string | null;
  publish_error: string | null;  // ← add
  special_ad_category: string;
  last_synced_at: string | null;
  created_at: string;
}
```

- [ ] **Step 3: Update `dbRowToCampaign` mapper in `src/app/(app)/campaigns/actions.ts`**

Find `function dbRowToCampaign` and add `publishError` after `metaStatus`:

```typescript
function dbRowToCampaign(row: CampaignDbRow): Campaign {
  return {
    id: row.id,
    accountId: row.account_id,
    metaCampaignId: row.meta_campaign_id,
    name: row.name,
    objective: row.objective as CampaignObjective,
    problemBrief: row.problem_brief,
    aiRationale: row.ai_rationale,
    budgetType: row.budget_type as BudgetType,
    budgetAmount: Number(row.budget_amount),
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as CampaignStatus,
    metaStatus: row.meta_status,
    publishError: row.publish_error ?? null,  // ← add
    specialAdCategory: row.special_ad_category as SpecialAdCategory,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    createdAt: new Date(row.created_at),
  };
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/campaigns.ts src/app/(app)/campaigns/actions.ts
git commit -m "feat: add publishError field to Campaign type and mapper"
```

---

## Chunk 2: Midnight utility + publishCampaign improvements

### Task 3: Create `toMidnightLondon` utility + tests

**Files:**
- Create: `src/lib/campaigns/time-utils.ts`
- Modify: `tests/campaigns/phases.test.ts`

- [ ] **Step 1: Write failing tests for `toMidnightLondon`**

Add at the bottom of `tests/campaigns/phases.test.ts`:

```typescript
import { toMidnightLondon } from '@/lib/campaigns/time-utils';

describe('toMidnightLondon', () => {
  it('returns midnight UTC for a GMT date (March, no BST offset)', () => {
    // 10 March 2026 is in GMT — London midnight = 00:00 UTC same day
    expect(toMidnightLondon('2026-03-10')).toBe('2026-03-10T00:00:00.000Z');
  });

  it('returns 23:00 UTC previous day for a BST date (July, UTC+1)', () => {
    // 10 July 2026 is in BST — London midnight = 23:00 UTC previous day
    expect(toMidnightLondon('2026-07-10')).toBe('2026-07-09T23:00:00.000Z');
  });

  it('handles the BST transition date (29 March 2026 — clocks go forward)', () => {
    // Clocks go forward at 01:00 local (01:00 UTC). At midnight London, BST has not yet
    // started — London is still in GMT (UTC+0). Midnight London = 00:00 UTC same day.
    expect(toMidnightLondon('2026-03-29')).toBe('2026-03-29T00:00:00.000Z');
  });

  it('handles the GMT transition date (25 October 2026 — clocks go back)', () => {
    // Clocks go back at 02:00 local (01:00 UTC). At midnight London, BST is still in
    // effect — London is at UTC+1. Midnight London = 23:00 UTC previous day.
    expect(toMidnightLondon('2026-10-25')).toBe('2026-10-24T23:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/campaigns/phases.test.ts
```

Expected: FAIL — `toMidnightLondon` is not defined.

- [ ] **Step 3: Create `src/lib/campaigns/time-utils.ts`**

```typescript
/**
 * Convert a YYYY-MM-DD calendar date to the UTC ISO string representing
 * midnight in the Europe/London timezone on that date.
 *
 * During GMT  (UTC+0, late October → late March): midnight London = 00:00 UTC same calendar day.
 * During BST  (UTC+1, late March  → late October): midnight London = 23:00 UTC previous calendar day.
 */
export function toMidnightLondon(isoDate: string): string {
  // Start at UTC midnight for that calendar date.
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`);

  // Ask Intl what hour London displays at UTC midnight.
  // In GMT: 00. In BST: 01.
  const londonHour = parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      hour12: false,
    }).format(utcMidnight),
    10,
  );

  // Step back by londonHour hours to reach the UTC instant that equals London midnight.
  const londonMidnight = new Date(utcMidnight.getTime() - londonHour * 60 * 60 * 1000);
  return londonMidnight.toISOString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/campaigns/phases.test.ts
```

Expected: all tests PASS (7 original + 4 new = 11 total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/time-utils.ts tests/campaigns/phases.test.ts
git commit -m "feat: add toMidnightLondon utility for Meta API phase date normalisation"
```

---

### Task 4: Update `publishCampaign` — partial-failure resume + `publish_error` ownership

**Files:**
- Modify: `src/app/(app)/campaigns/[id]/actions.ts`

`publishCampaign` is extended to:
1. Skip already-published objects (resume after partial failure)
2. Write `publish_error` to DB on any failure
3. Clear `publish_error` and set `status = ACTIVE` on success

This means the retry path (Retry button → `publishCampaign` directly) works correctly without any additional logic.

- [ ] **Step 1: Add `toMidnightLondon` import**

At the top of `src/app/(app)/campaigns/[id]/actions.ts`, add:

```typescript
import { toMidnightLondon } from '@/lib/campaigns/time-utils';
```

- [ ] **Step 2: Extend `CampaignRow` to include `meta_campaign_id`**

Find `interface CampaignRow` and add `meta_campaign_id`:

```typescript
interface CampaignRow {
  id: string;
  account_id: string;
  meta_campaign_id: string | null;   // ← add
  name: string;
  objective: string;
  special_ad_category: string;
  budget_type: string;
  budget_amount: number;
  start_date: string;
  end_date: string | null;
}
```

Update the campaign select query to include `meta_campaign_id`:

```typescript
const { data: campaign, error: campaignError } = await supabase
  .from('meta_campaigns')
  .select(
    'id, account_id, meta_campaign_id, name, objective, special_ad_category, budget_type, budget_amount, start_date, end_date',
  )
  .eq('id', campaignId)
  .eq('account_id', accountId)
  .single<CampaignRow>();
```

- [ ] **Step 3: Extend `AdSetRow` and `AdRow` to include Meta IDs**

```typescript
interface AdRow {
  id: string;
  meta_ad_id: string | null;       // ← add
  name: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  media_asset_id: string | null;
}

interface AdSetRow {
  id: string;
  meta_adset_id: string | null;    // ← add
  name: string;
  targeting: Record<string, unknown>;
  optimisation_goal: string;
  bid_strategy: string;
  budget_amount: number | null;
  phase_start: string | null;
  phase_end: string | null;
  ads: AdRow[];
}
```

Update the ad sets select to include both IDs:

```typescript
const adSetsResult = await supabase
  .from('ad_sets')
  .select(
    'id, meta_adset_id, name, targeting, optimisation_goal, bid_strategy, budget_amount, phase_start, phase_end, ads(id, meta_ad_id, name, headline, primary_text, description, cta, media_asset_id)',
  )
  .eq('campaign_id', campaignId);
```

- [ ] **Step 4: Add a helper to write `publish_error` (top of the function, before the try block)**

Add this helper just before the `try {` in `publishCampaign`:

```typescript
// Helper: persist publish_error and reset campaign to DRAFT.
const setPublishError = async (message: string) => {
  try {
    await supabase
      .from('meta_campaigns')
      .update({ publish_error: message })
      .eq('id', campaignId);
  } catch {
    // Best-effort — swallow DB errors during error handling.
  }
};
```

- [ ] **Step 5: Replace the Meta campaign creation block with a resume-aware version**

Find step 6 (create Meta campaign) and replace:

```typescript
// ── 6. Create Meta campaign (or resume if already created) ────────────────

let metaCampaignId: string;

if (campaign.meta_campaign_id) {
  // Resuming after a partial failure — use the existing Meta campaign.
  metaCampaignId = campaign.meta_campaign_id;
} else {
  const metaCampaign = await createMetaCampaign({
    accessToken,
    adAccountId,
    name: campaign.name,
    objective: campaign.objective,
    specialAdCategory: campaign.special_ad_category,
    status: 'PAUSED',
  });

  metaCampaignId = metaCampaign.id;
  createdMetaObjects.push(metaCampaignId);

  await supabase
    .from('meta_campaigns')
    .update({ meta_campaign_id: metaCampaignId })
    .eq('id', campaignId);
}
```

- [ ] **Step 6: Update the ad set loop to use `metaCampaignId`, skip already-published ad sets, and use `toMidnightLondon`**

Replace the ad set creation section inside the loop (the `createMetaAdSet` call):

```typescript
for (const adSet of adSets) {
  const budgetAmount = adSet.budget_amount ?? Number(campaign.budget_amount);
  const isDaily = campaign.budget_type === 'DAILY';

  let metaAdSetId: string;

  if (adSet.meta_adset_id) {
    // Already published — skip creation, reuse existing ID.
    metaAdSetId = adSet.meta_adset_id;
  } else {
    let metaAdSet: { id: string };
    try {
      metaAdSet = await createMetaAdSet({
        accessToken,
        adAccountId,
        campaignId: metaCampaignId,
        name: adSet.name,
        targeting: adSet.targeting,
        optimisationGoal: adSet.optimisation_goal,
        bidStrategy: adSet.bid_strategy,
        dailyBudget: isDaily ? budgetAmount : undefined,
        lifetimeBudget: !isDaily ? budgetAmount : undefined,
        startTime: toMidnightLondon(adSet.phase_start ?? campaign.start_date),
        endTime:
          adSet.phase_end
            ? toMidnightLondon(adSet.phase_end)
            : campaign.end_date
              ? toMidnightLondon(campaign.end_date)
              : undefined,
        status: 'PAUSED',
      });
    } catch (adSetError) {
      console.error(`[publishCampaign] Failed to create ad set "${adSet.name}":`, adSetError);
      continue;
    }

    metaAdSetId = metaAdSet.id;
    createdMetaObjects.push(metaAdSetId);

    await supabase
      .from('ad_sets')
      .update({ meta_adset_id: metaAdSetId, status: 'ACTIVE' })
      .eq('id', adSet.id);
  }

  // ── Process ads ──────────────────────────────────────────────────────────
  const ads: AdRow[] = Array.isArray(adSet.ads) ? adSet.ads : [];

  for (const ad of ads) {
    if (ad.meta_ad_id) continue;       // Already published.
    if (!ad.media_asset_id) continue;  // No creative — skip.

    try {
      // ... rest of ad creation code UNCHANGED from current implementation ...
    } catch (adError) {
      console.error(`[publishCampaign] Failed to create ad "${ad.name}":`, adError);
    }
  }
}
```

**Important:** The ad creative/upload code inside the ad loop is unchanged — copy it as-is from the existing implementation.

- [ ] **Step 7: Update step 8 (mark ACTIVE) to clear `publish_error`**

Find the step 8 block and replace:

```typescript
// ── 8. Mark campaign ACTIVE ───────────────────────────────────────────────

await supabase
  .from('meta_campaigns')
  .update({ status: 'ACTIVE', meta_status: 'ACTIVE', publish_error: null })
  .eq('id', campaignId);
```

- [ ] **Step 8: Update the catch block to call `setPublishError`**

Find the outer catch block and add a call to `setPublishError`:

```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : 'Failed to publish campaign.';

  // Write the error to the DB so the detail page can surface it.
  await setPublishError(message);

  // Best-effort rollback: pause all created Meta objects.
  for (const metaObjectId of createdMetaObjects) {
    try {
      await pauseMetaObject(metaObjectId, accessToken);
    } catch (rollbackErr) {
      console.error(`[publishCampaign] Rollback failed for ${metaObjectId}:`, rollbackErr);
    }
  }

  // Reset campaign status to DRAFT.
  try {
    await supabase
      .from('meta_campaigns')
      .update({ status: 'DRAFT', meta_status: null })
      .eq('id', campaignId);
  } catch (updateErr) {
    console.error('[publishCampaign] Failed to reset campaign status after error:', updateErr);
  }

  return { error: message };
}
```

- [ ] **Step 9: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Run tests**

```bash
npx vitest run
```

Expected: all existing tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/app/(app)/campaigns/[id]/actions.ts
git commit -m "feat: partial-failure resume and publish_error ownership in publishCampaign"
```

---

## Chunk 3: saveAndPublishCampaign action + tests

### Task 5: Add `saveAndPublishCampaign` + tests

**Files:**
- Modify: `src/app/(app)/campaigns/actions.ts`
- Create: `tests/campaigns/campaign-actions.test.ts`

`saveAndPublishCampaign` calls `saveCampaignDraft` then `publishCampaign`. Since `publishCampaign` now owns `publish_error` writes, this action only needs to handle the save-failure case.

The tests mock `createServiceSupabaseClient` (so the internal `saveCampaignDraft` call hits a mock Supabase) and mock `publishCampaign` from its own module.

- [ ] **Step 1: Write failing tests**

Create `tests/campaigns/campaign-actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase — applies to all DB calls inside saveCampaignDraft.
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

// Mock auth — saveCampaignDraft calls requireAuthContext.
vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));

// Mock publishCampaign from its own module.
vi.mock('@/app/(app)/campaigns/[id]/actions', () => ({
  publishCampaign: vi.fn(),
}));

// Mock next/cache.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { saveAndPublishCampaign } from '@/app/(app)/campaigns/actions';
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// Build a chainable Supabase mock where insert → select → single resolves.
// The payload has no ad_sets so only meta_campaigns insert is called.
function makeInsertMock(campaignData: { id: string } | null, insertError: { message: string } | null = null) {
  const singleFn = vi.fn().mockResolvedValue({ data: campaignData, error: insertError });
  const selectFn = vi.fn().mockReturnValue({ single: singleFn });
  const insertFn = vi.fn().mockReturnValue({ select: selectFn });
  const fromFn = vi.fn().mockReturnValue({ insert: insertFn, select: selectFn });

  return { from: fromFn, _singleFn: singleFn };
}

const mockPayload = {
  campaign_name: 'Test Campaign',
  objective: 'OUTCOME_AWARENESS' as const,
  rationale: 'Test rationale',
  special_ad_category: 'NONE' as const,
  ad_sets: [], // no ad sets → no ad_set inserts → simpler mock
};

const mockMeta = {
  budgetAmount: 500,
  budgetType: 'DAILY' as const,
  startDate: '2026-04-01',
  endDate: '2026-04-10',
  adsStopTime: '22:00',
  problemBrief: 'Test brief',
};

describe('saveAndPublishCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves and publishes — returns { campaignId } on full success', async () => {
    const supabase = makeInsertMock({ id: 'campaign-abc' });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(supabase as never);
    vi.mocked(publishCampaign).mockResolvedValue({ success: true });

    const result = await saveAndPublishCampaign(mockPayload, mockMeta);

    expect(result).toEqual({ campaignId: 'campaign-abc' });
    expect(publishCampaign).toHaveBeenCalledWith('campaign-abc');
  });

  it('returns { campaignId } when publish fails — publishCampaign is called and handles the error write', async () => {
    const supabase = makeInsertMock({ id: 'campaign-abc' });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(supabase as never);
    vi.mocked(publishCampaign).mockResolvedValue({ error: 'Meta rejected the ad creative.' });

    const result = await saveAndPublishCampaign(mockPayload, mockMeta);

    // Campaign was saved — should still redirect.
    expect(result).toEqual({ campaignId: 'campaign-abc' });
    // publishCampaign was called and owns the publish_error write internally.
    expect(publishCampaign).toHaveBeenCalledWith('campaign-abc');
  });

  it('returns { error } immediately when save fails — publishCampaign is never called', async () => {
    const supabase = makeInsertMock(null, { message: 'DB constraint violation' });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(supabase as never);

    const result = await saveAndPublishCampaign(mockPayload, mockMeta);

    expect(result).toEqual({ error: 'DB constraint violation' });
    expect(publishCampaign).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/campaigns/campaign-actions.test.ts
```

Expected: FAIL — `saveAndPublishCampaign is not a function`.

- [ ] **Step 3: Add `saveAndPublishCampaign` to `src/app/(app)/campaigns/actions.ts`**

First, add the import from the `[id]/actions` module at the top (with other imports):

```typescript
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';
```

Then add the function after `saveCampaignDraft`:

```typescript
// ---------------------------------------------------------------------------
// saveAndPublishCampaign
// ---------------------------------------------------------------------------

/**
 * Saves a campaign draft then immediately publishes it to Meta Ads Manager.
 *
 * - Save failure: returns { error } — nothing was written to DB.
 * - Save success + publish failure: returns { campaignId } — campaign is saved
 *   as DRAFT. publishCampaign writes publish_error internally.
 * - Save success + publish success: returns { campaignId } — campaign is ACTIVE.
 *
 * The caller should always redirect to /campaigns/[campaignId] unless { error }.
 */
export async function saveAndPublishCampaign(
  payload: AiCampaignPayload,
  meta: SaveCampaignMeta,
): Promise<{ campaignId: string } | { error: string }> {
  // saveCampaignDraft re-verifies auth via requireAuthContext internally.
  const saveResult = await saveCampaignDraft(payload, meta);

  if ('error' in saveResult) {
    return { error: saveResult.error };
  }

  const { campaignId } = saveResult;

  // Publish inline. publishCampaign owns publish_error writes on both failure
  // and success, so no additional DB write is needed here.
  await publishCampaign(campaignId);

  return { campaignId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/campaigns/campaign-actions.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/campaigns/actions.ts tests/campaigns/campaign-actions.test.ts
git commit -m "feat: add saveAndPublishCampaign action"
```

---

## Chunk 4: UI changes

### Task 6: Update `CampaignBriefForm` — button and action

**Files:**
- Modify: `src/features/campaigns/CampaignBriefForm.tsx`

- [ ] **Step 1: Replace `saveCampaignDraft` import with `saveAndPublishCampaign`**

Find line 11:
```typescript
import { generateCampaignAction, saveCampaignDraft } from '@/app/(app)/campaigns/actions';
```
Replace with:
```typescript
import { generateCampaignAction, saveAndPublishCampaign } from '@/app/(app)/campaigns/actions';
```

- [ ] **Step 2: Rename `handleSaveDraft` → `handleSaveAndPublish` and update the body**

Find `async function handleSaveDraft()` and replace the entire function:

```typescript
async function handleSaveAndPublish() {
  if (!aiPayload) return;
  setIsSubmitting(true);
  const result = await saveAndPublishCampaign(aiPayload, {
    budgetAmount,
    budgetType,
    startDate,
    endDate: endDate ?? '',
    adsStopTime,
    problemBrief,
  });
  if ('error' in result) {
    toast.error(result.error);
    setIsSubmitting(false);
    return;
  }
  router.push(`/campaigns/${result.campaignId}`);
}
```

- [ ] **Step 3: Update the button JSX**

Find the button that calls `handleSaveDraft`:
```tsx
<Button onClick={handleSaveDraft} disabled={isSubmitting}>
  {isSubmitting ? 'Saving…' : 'Save Draft'}
</Button>
```
Replace with:
```tsx
<Button onClick={handleSaveAndPublish} disabled={isSubmitting}>
  {isSubmitting ? 'Publishing to Meta…' : 'Save & Publish'}
</Button>
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/campaigns/CampaignBriefForm.tsx
git commit -m "feat: replace Save Draft with Save & Publish in campaign form"
```

---

### Task 7: Create `CampaignActions` component + update detail page + delete `PublishButton`

**Files:**
- Create: `src/features/campaigns/CampaignActions.tsx`
- Modify: `src/app/(app)/campaigns/[id]/page.tsx`
- Delete: `src/features/campaigns/PublishButton.tsx`

- [ ] **Step 1: Create `src/features/campaigns/CampaignActions.tsx`**

```tsx
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { useToast } from '@/components/providers/toast-provider';
import { publishCampaign, pauseCampaign } from '@/app/(app)/campaigns/[id]/actions';

interface CampaignActionsProps {
  campaignId: string;
  status: string;
  publishError: string | null;
}

export function CampaignActions({ campaignId, status, publishError }: CampaignActionsProps) {
  const toast = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Active campaign: show Pause button.
  if (status === 'ACTIVE') {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await pauseCampaign(campaignId);
            if (result.success) {
              toast.success('Campaign paused');
              router.refresh();
            } else {
              toast.error('Pause failed', { description: result.error });
            }
          });
        }}
        className="rounded-full border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
      >
        {isPending ? 'Pausing…' : 'Pause Campaign'}
      </button>
    );
  }

  // Draft with a publish error: show Retry button.
  if (status === 'DRAFT' && publishError) {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await publishCampaign(campaignId);
            if (result.success) {
              toast.success('Campaign published to Meta');
            } else {
              toast.error('Publish failed', { description: result.error });
            }
            // Always refresh — publishCampaign updates publish_error in DB.
            router.refresh();
          });
        }}
        className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:opacity-60"
      >
        {isPending ? 'Retrying…' : 'Retry Publish'}
      </button>
    );
  }

  return null;
}
```

- [ ] **Step 2: Replace `src/app/(app)/campaigns/[id]/page.tsx`**

Write the complete file:

```tsx
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/layout/PageHeader';
import type { CampaignObjective, CampaignStatus } from '@/types/campaigns';
import { CampaignActions } from '@/features/campaigns/CampaignActions';
import { getCampaignWithTree } from '../actions';

interface CampaignDetailPageProps {
  params: Promise<{ id: string }>;
}

const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_SALES: 'Sales',
};

const STATUS_STYLES: Record<CampaignStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-secondary text-secondary-foreground',
};

export default async function CampaignDetailPage({ params }: CampaignDetailPageProps) {
  const { id } = await params;
  const campaign = await getCampaignWithTree(id);

  if (!campaign) {
    notFound();
  }

  const objectiveLabel = OBJECTIVE_LABELS[campaign.objective];
  const statusStyle = STATUS_STYLES[campaign.status];

  return (
    <div className="flex flex-col gap-6 font-sans">
      <PageHeader
        title={campaign.name}
        description={`${objectiveLabel} · ${campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}`}
        action={
          <CampaignActions
            campaignId={campaign.id}
            status={campaign.status}
            publishError={campaign.publishError ?? null}
          />
        }
      />

      {/* Status badge */}
      <div className="flex items-center gap-3">
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusStyle}`}>
          {campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}
        </span>
        <span className="text-sm text-muted-foreground">
          {campaign.budgetType === 'DAILY'
            ? `£${campaign.budgetAmount}/day`
            : `£${campaign.budgetAmount} total`}
        </span>
        <span className="text-sm text-muted-foreground">
          {campaign.startDate}
          {campaign.endDate ? ` – ${campaign.endDate}` : ' onwards'}
        </span>
      </div>

      {/* Publish error panel — shown when save succeeded but Meta publish failed */}
      {campaign.status === 'DRAFT' && campaign.publishError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
            Publishing failed
          </p>
          <p className="text-sm text-red-800">{campaign.publishError}</p>
          <p className="mt-1 text-xs text-red-600">
            Your campaign has been saved. Use the &ldquo;Retry Publish&rdquo; button to try again.
          </p>
        </div>
      )}

      {/* AI rationale */}
      {campaign.aiRationale && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            AI rationale
          </p>
          <p className="text-sm text-foreground">{campaign.aiRationale}</p>
        </div>
      )}

      {/* Ad sets and ads */}
      <div className="space-y-4">
        {campaign.adSets?.map((adSet) => (
          <details
            key={adSet.id}
            className="rounded-xl border border-border bg-background overflow-hidden"
            open
          >
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
              <div>
                <span className="text-sm font-semibold text-foreground">{adSet.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {adSet.ads?.length ?? 0} ad{(adSet.ads?.length ?? 0) !== 1 ? 's' : ''}
                </span>
              </div>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[adSet.status as CampaignStatus] ?? 'bg-muted text-muted-foreground'}`}
              >
                {adSet.status.charAt(0) + adSet.status.slice(1).toLowerCase()}
              </span>
            </summary>

            <div className="border-t border-border divide-y divide-border">
              {adSet.ads?.map((ad) => (
                <div key={ad.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{ad.headline}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {ad.primaryText}
                      </p>
                    </div>
                    {!ad.mediaAssetId && (
                      <span className="flex-shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        No creative
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {(!adSet.ads || adSet.ads.length === 0) && (
                <div className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">No ads in this ad set.</p>
                </div>
              )}
            </div>
          </details>
        ))}

        {(!campaign.adSets || campaign.adSets.length === 0) && (
          <p className="text-sm text-muted-foreground">No ad sets found for this campaign.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Delete `PublishButton.tsx`**

```bash
rm /Users/peterpitcher/Cursor/OJ-CheersAI2.0/src/features/campaigns/PublishButton.tsx
```

- [ ] **Step 4: Check for any remaining `PublishButton` references**

```bash
grep -r "PublishButton" /Users/peterpitcher/Cursor/OJ-CheersAI2.0/src --include="*.ts" --include="*.tsx"
```

Expected: no output (all references removed).

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Build**

```bash
npm run build
```

Expected: successful production build.

- [ ] **Step 8: Commit**

```bash
git add src/features/campaigns/CampaignActions.tsx src/app/(app)/campaigns/\[id\]/page.tsx
git rm src/features/campaigns/PublishButton.tsx
git commit -m "feat: add CampaignActions component, error panel, retry button; remove PublishButton"
```

---

## Final verification

- [ ] **Run full CI pipeline**

```bash
npm run ci:verify
```

Expected: lint ✅  typecheck ✅  tests ✅  build ✅

- [ ] **Manual smoke test**
  1. Fill the campaign form → click **Save & Publish** — button shows "Publishing to Meta…"
  2. Success path: redirected to `/campaigns/[id]` with ACTIVE badge and "Pause Campaign" button
  3. Failure path (disconnect Meta first): redirected to `/campaigns/[id]` with red error panel and "Retry Publish" button
  4. Click "Retry Publish" — on success badge flips to ACTIVE; on failure error message updates
  5. Active campaign: "Pause Campaign" button works as before
