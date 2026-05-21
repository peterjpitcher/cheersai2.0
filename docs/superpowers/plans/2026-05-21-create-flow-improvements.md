# Create Flow Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the create wizard's publish pipeline so scheduled posts actually publish, persist full reviewed copy, and harden security and UX across the flow.

**Architecture:** Four waves: Wave 0 fixes publish correctness (jobs, copy, metadata, payload, calendar). Wave 1 hardens immediate security and reliability issues (account guards, cron auth, failure callbacks, legacy function auth). Wave 2 improves UX (labels, presets, previews, layout). Wave 3 closes CI, token-vault migration, ops, SEO, schema, and cleanup items. Each wave should produce coherent commits, but A0 and B3 are a deployment gate: do not deploy scheduled-job creation without the corrected QStash payload path that those jobs will use.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase PostgreSQL + RLS, QStash, Vitest, Luxon, React 19.

**Spec:** `tasks/SPEC-create-flow-improvements.md`

---

## Execution Corrections Before Implementation

These corrections supersede any lower-level snippet in this plan if a conflict appears.

- Put new tests under `tests/` following repository convention, mirroring `src/` paths. Do not add colocated `*.test.ts` files under `src/` for this work.
- For server-action tests, use a table-aware or operation-sequenced Supabase mock. A single `mockReturnThis()` object cannot accurately represent `createScheduledBatch()` because it performs multiple independent operations across `draft_content`, `campaigns`, `content_items`, `content_variants`, `content_media_attachments`, and `publish_jobs`.
- A0 must not return a partial success that leaves content rows without publish jobs. Use a DB transaction/RPC if available; otherwise implement best-effort rollback for inserted jobs, attachments, variants, content items, and any newly-created campaign, then return a hard error with no `contentItemIds`.
- Preserve existing persisted semantics unless the codebase proves a migration is intended. In particular, wizard-created campaigns currently use `status: 'scheduled'`; do not change them to `active` as part of A2.
- Preserve the existing `getCalendarItemsAction()` display DTO: `scheduledFor`, `platform`, `status`, `placement`, `campaignName`, and `mediaPreview`. Add account scoping and signed previews without replacing it with a different client contract.
- B3 includes all of these: provider-accessible signed media URLs, derived-media selection by placement, rendered banner media for banner-enabled posts, event/offer/GBP CTA details, and `adapter.validate()` before any provider publish call.
- B2 account guards cover `getCalendarItemsAction()`, `getDraft()`, `listDrafts()`, `attachMediaToContent()`, and `reorderLinkInBioTiles()`.
- `createSignedUrls()` batch signing should be preferred over per-path signing where multiple media paths are known.
- The plan must close or explicitly defer every B-item in the spec. Missing audit items are added to Wave 3 below.

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `src/lib/publishing/compose-body.ts` | Build publishable text from structured PlatformCopy per platform |
| `tests/lib/publishing/compose-body.test.ts` | Unit tests for body composition |
| `src/lib/publishing/build-campaign-metadata.ts` | Build timing-compatible campaign metadata from wizard brief |
| `tests/lib/publishing/build-campaign-metadata.test.ts` | Unit tests for metadata builder |
| `src/lib/publishing/resolve-media-urls.ts` | Resolve publish media paths, banner-rendered assets, and provider-accessible signed URLs |
| `tests/lib/publishing/resolve-media-urls.test.ts` | Unit tests for media URL resolution |
| `src/lib/security/cron-auth.ts` | Shared cron route authentication utility |
| `tests/lib/security/cron-auth.test.ts` | Unit tests for cron auth |
| `src/features/create/schedule/infer-slot-label.ts` | Infer semantic labels for manual slots from brief context |
| `tests/features/create/schedule/infer-slot-label.test.ts` | Unit tests for label inference |
| `src/lib/ai/temporal-instructions.ts` | Build temporal prompt instructions from slot label + dates |
| `tests/lib/ai/temporal-instructions.test.ts` | Unit tests for temporal instructions |

### Modified files

| File | Changes |
|------|---------|
| `src/app/actions/content.ts` | A0: call `enqueueAndDispatch` in schedule mode; A1: persist full copy + preview_data; A2: use metadata builder; A3: add account_id filter + signed previews |
| `src/lib/publishing/handler.ts` | B3: sign media URLs, render banners, populate event/offer details, call adapter.validate |
| `src/lib/publishing/dispatch.ts` | B6: set failureCallback URL |
| `src/lib/publishing/queue.ts` | No changes needed — already handles both modes correctly |
| `src/types/providers.ts` | B3/A1: add any structured publish fields required by GBP CTA handling |
| `src/lib/providers/gbp/adapter.ts` | B3/A1: consume structured GBP CTA data if supported by the GBP API payload |
| `src/features/create/steps/schedule-step.tsx` | A4: use `inferSlotLabel`; A5: time presets; A3: fetch warning UI |
| `src/features/create/schedule/schedule-calendar.tsx` | A5: replace time input with preset buttons |
| `src/features/create/steps/generate-step.tsx` | A7: banner preview; A8: auto-expand textarea; A9: remove nested scroll |
| `src/features/create/create-wizard.tsx` | A7: pass media/banner data; A11: labels in staleness check |
| `src/features/create/create-modal-actions.ts` | A7: return banner defaults from ownerSettings |
| `src/components/layout/app-shell.tsx` | A10: remove max-w-[1440px], add responsive padding |
| `src/lib/ai/prompts.ts` | A6: use temporal instruction builder |
| `src/app/api/cron/publish-scheduler/route.ts` | B5: use shared cron auth |
| `src/app/api/cron/purge-trash/route.ts` | B5: use shared cron auth |
| `src/app/api/cron/sync-meta-campaigns/route.ts` | B5: use shared cron auth |
| `src/app/api/cron/optimise-meta-campaigns/route.ts` | B5: use shared cron auth |
| `src/app/api/cron/sync-gbp-reviews/route.ts` | B5: use shared cron auth |
| `src/app/api/cron/notify-failures/route.ts` | B5: use shared cron auth |
| `src/app/api/cron/notify-expiring-connections/route.ts` | B5: use shared cron auth |
| `src/app/api/cron/gbp-metrics/route.ts` | B5: use shared cron auth if route is retained |
| `src/app/api/cron/recurring-publish/route.ts` | B5: use shared cron auth if route is retained |
| `src/app/api/cron/token-health/route.ts` | B5: use shared cron auth if route is retained |
| `src/lib/link-in-bio/profile.ts` | B2: validate reorder IDs belong to the authenticated account before upsert |
| `tests/lib/create/service.test.ts` | B8: fix date-sensitive test fixtures |
| `.env.example` | B17: reconcile documented environment variables with `src/env.ts` |

---

# Wave 0: Publish and Data Correctness

## Task 1: Create Publish Jobs for Scheduled Wizard Batches (A0)

**Files:**
- Modify: `src/app/actions/content.ts` — `createScheduledBatch()` function
- Test: `tests/app/actions/content.test.ts` (new or extend existing)

This is the highest-priority fix. Currently `createScheduledBatch()` only calls `enqueueAndDispatch()` when `mode === 'queue_now'`. Scheduled posts get `content_items` rows but no `publish_jobs`, so the cron scheduler never promotes them.

The core publish-job fix is straightforward: `enqueueAndDispatch()` already creates jobs with `status: 'scheduled'` for future dates and only dispatches within the 60s immediate threshold. The implementation still needs rollback/transaction handling so a later enqueue failure does not leave orphaned scheduled content.

- [ ] **Step 1: Write failing test for scheduled mode publish job creation**

Create `tests/app/actions/content.test.ts`. The important assertion is behavioral: scheduled mode calls `enqueueAndDispatch()` once per inserted content item. Use an operation-sequenced Supabase mock; the sketch below is illustrative and must be adapted so each `.from(table)` chain resolves the correct terminal operation.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn(),
}));

vi.mock('@/lib/publishing/queue', () => ({
  enqueueAndDispatch: vi.fn().mockResolvedValue({ jobId: 'job-1', dispatched: false }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { requireAuthContext } from '@/lib/auth/server';
import { enqueueAndDispatch } from '@/lib/publishing/queue';

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

describe('createScheduledBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthContext).mockResolvedValue({
      supabase: mockSupabase as never,
      accountId: 'acc-1',
      user: { id: 'user-1', email: 'test@test.com', accountId: 'acc-1', businessName: 'Test', timezone: 'Europe/London' },
    });
  });

  it('creates publish_jobs for every content item in schedule mode', async () => {
    // Mock draft lookup
    mockSupabase.single.mockResolvedValueOnce({ data: { id: 'draft-1' }, error: null });
    // Mock campaign insert
    mockSupabase.single.mockResolvedValueOnce({ data: { id: 'camp-1' }, error: null });
    // Mock content_items insert — 2 slots x 2 platforms = 4 items
    mockSupabase.select.mockReturnValueOnce({
      data: [
        { id: 'ci-1', platform: 'facebook' },
        { id: 'ci-2', platform: 'instagram' },
        { id: 'ci-3', platform: 'facebook' },
        { id: 'ci-4', platform: 'instagram' },
      ],
      error: null,
    });
    // Mock variant upsert
    mockSupabase.upsert.mockReturnValueOnce({ error: null });
    // Mock attachment insert
    mockSupabase.insert.mockReturnValueOnce({ error: null });
    // Mock draft delete
    mockSupabase.eq.mockReturnValueOnce({ error: null });

    const { createScheduledBatch } = await import('@/app/actions/content');

    const result = await createScheduledBatch({
      draftContentId: 'draft-1',
      contentType: 'event',
      brief: { title: 'Test Event', eventDate: '2026-06-15', eventTime: '19:00' },
      selectedMediaIds: [],
      slotCopies: [
        { slotKey: 'slot-1', scheduledAt: '2026-06-14T10:00:00.000Z', label: '1 day to go', copy: { facebook: { body: 'FB1' }, instagram: { body: 'IG1' }, gbp: { body: 'GBP1' } } },
        { slotKey: 'slot-2', scheduledAt: '2026-06-15T10:00:00.000Z', label: 'Event day', copy: { facebook: { body: 'FB2' }, instagram: { body: 'IG2' }, gbp: { body: 'GBP2' } } },
      ],
      platforms: ['facebook', 'instagram'],
      mode: 'schedule',
    });

    expect(result.error).toBeUndefined();
    expect(enqueueAndDispatch).toHaveBeenCalledTimes(4);
    expect(enqueueAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        platform: 'facebook',
      }),
    );
  });
});
```

Add a second failing test where one `enqueueAndDispatch()` call rejects. It should assert that the action returns a hard error, does not include `contentItemIds`, and issues cleanup deletes for the rows created earlier in the batch.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/actions/content.test.ts -v`
Expected: FAIL — `enqueueAndDispatch` called 0 times, expected 4.

- [ ] **Step 3: Implement — call enqueueAndDispatch for both modes**

In `src/app/actions/content.ts`, find the block after media attachment insertion that starts with `if (mode === 'queue_now')`. Replace it with:

```typescript
    // Enqueue publish jobs for ALL modes — enqueueAndDispatch handles
    // future vs immediate scheduling internally (PUB-03)
    for (const [index, item] of insertedItems.entries()) {
      const { slotIdx, platform } = slotPlatformIndex[index];
      const slot = slotCopies[slotIdx];
      const scheduledAt = slot.scheduledAt
        ? new Date(slot.scheduledAt)
        : new Date();

      try {
        await enqueueAndDispatch({
          contentItemId: item.id,
          accountId,
          platform: platform as Platform,
          scheduledAt,
        });
      } catch (publishError) {
        console.error(
          `[createScheduledBatch] Failed to create publish job for ${item.id}:`,
          publishError instanceof Error ? publishError.message : publishError,
        );

        await rollbackCreatedScheduledBatch({
          supabase,
          contentItemIds: insertedItems.map((i) => i.id),
          campaignId,
          deleteCampaign: Boolean(campaignId),
        });

        return {
          error: `Publish job creation failed for item ${index + 1}. No content was scheduled; please retry.`,
        };
      }
    }
```

Remove the old `if (mode === 'queue_now') { ... }` block entirely. Implement `rollbackCreatedScheduledBatch()` in the same module or a small local helper before this loop ships. It must delete inserted `publish_jobs`, `content_media_attachments`, `content_variants`, `content_items`, and any campaign created by this call. If rollback itself fails, log the rollback error with all inserted IDs and return an error that tells the caller the batch needs manual cleanup; do not return `contentItemIds` as a successful result.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app/actions/content.test.ts -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test -- --run`
Expected: All existing tests still pass (except the known B8 date fixture failure).

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/content.ts tests/app/actions/content.test.ts
git commit -m "fix(A0): create publish_jobs for scheduled wizard batches

enqueueAndDispatch() already handles future vs immediate scheduling.
Previously only called in queue_now mode, leaving scheduled posts
without publish_jobs rows for the cron scheduler to promote."
```

---

## Task 2: Persist Full Reviewed Platform Copy (A1)

**Files:**
- Create: `src/lib/publishing/compose-body.ts`
- Create: `tests/lib/publishing/compose-body.test.ts`
- Modify: `src/app/actions/content.ts` — variant upsert in `createScheduledBatch()`

The wizard's generate step shows the user reviewed copy with hashtags, CTA text, and link-in-bio lines per platform. But `createScheduledBatch()` only persists `slot.copy[platform].body`. Everything else is dropped.

- [ ] **Step 1: Write failing test for body composition**

Create `tests/lib/publishing/compose-body.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { composePublishBody } from '@/lib/publishing/compose-body';

describe('composePublishBody', () => {
  describe('facebook', () => {
    it('appends CTA and hashtags to body', () => {
      const result = composePublishBody('facebook', {
        body: 'Join us tonight!',
        ctaText: 'Book your table now',
        hashtags: ['#PubNight', '#LiveMusic'],
      });
      expect(result).toBe('Join us tonight!\n\nBook your table now\n\n#PubNight #LiveMusic');
    });

    it('returns body alone when no extras', () => {
      const result = composePublishBody('facebook', { body: 'Simple post' });
      expect(result).toBe('Simple post');
    });
  });

  describe('instagram', () => {
    it('appends link-in-bio and hashtags', () => {
      const result = composePublishBody('instagram', {
        body: 'New menu alert!',
        linkInBioLine: 'Link in bio for bookings',
        hashtags: ['#FoodPub', '#NewMenu'],
      });
      expect(result).toBe('New menu alert!\n\nLink in bio for bookings\n\n#FoodPub #NewMenu');
    });
  });

  describe('gbp', () => {
    it('returns body only — CTA is an API field, not body text', () => {
      const result = composePublishBody('gbp', {
        body: 'We are open for business.',
        ctaAction: 'BOOK',
      });
      expect(result).toBe('We are open for business.');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/publishing/compose-body.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement composePublishBody**

Create `src/lib/publishing/compose-body.ts`:

```typescript
import type { PlatformCopy } from '@/types/content';
import type { Platform } from '@/types/content';

type PlatformCopyEntry = PlatformCopy[Platform];

export function composePublishBody(
  platform: Platform,
  copy: PlatformCopyEntry,
): string {
  const parts: string[] = [copy.body];

  if (platform === 'facebook') {
    const fb = copy as PlatformCopy['facebook'];
    if (fb.ctaText?.trim()) parts.push(fb.ctaText.trim());
    if (fb.hashtags?.length) parts.push(fb.hashtags.join(' '));
  }

  if (platform === 'instagram') {
    const ig = copy as PlatformCopy['instagram'];
    if (ig.linkInBioLine?.trim()) parts.push(ig.linkInBioLine.trim());
    if (ig.hashtags?.length) parts.push(ig.hashtags.join(' '));
  }

  // GBP: body only — ctaAction is a separate API field stored in preview_data

  return parts.join('\n\n');
}

export function buildPreviewData(
  platform: Platform,
  copy: PlatformCopyEntry,
  slotContext?: { slotLabel?: string; slotKey?: string; brief?: Record<string, unknown> },
): Record<string, unknown> {
  return {
    structuredCopy: copy,
    platform,
    ...(slotContext ?? {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/publishing/compose-body.test.ts -v`
Expected: PASS

- [ ] **Step 5: Update createScheduledBatch to use composePublishBody and persist preview_data**

In `src/app/actions/content.ts`, update the variant payload construction. Find where `variantPayloads` is built (the `.map()` over `insertedItems`):

```typescript
    import { composePublishBody, buildPreviewData } from '@/lib/publishing/compose-body';

    // ... inside createScheduledBatch, after content_items insert ...

    const variantPayloads = insertedItems.map((item, index) => {
      const { slotIdx, platform } = slotPlatformIndex[index];
      const slot = slotCopies[slotIdx];
      const copy = slot.copy[platform as Platform];
      const body = composePublishBody(platform as Platform, copy);
      const previewData = buildPreviewData(platform as Platform, copy, {
        slotLabel: slot.label,
        slotKey: slot.slotKey,
        brief,
      });

      return {
        content_item_id: item.id,
        body,
        preview_data: previewData,
        media_ids: selectedMediaIds.length > 0 ? selectedMediaIds : null,
      };
    });
```

- [ ] **Step 6: Update Task 1 test mocks to account for new import, run tests**

Run: `npx vitest run tests/lib/publishing/compose-body.test.ts tests/app/actions/content.test.ts -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/publishing/compose-body.ts tests/lib/publishing/compose-body.test.ts src/app/actions/content.ts
git commit -m "fix(A1): persist full reviewed platform copy including hashtags, CTA, and preview_data

Wizard review step shows hashtags and CTA text per platform, but only body
was persisted. Now composes full publishable text and stores structured
copy in content_variants.preview_data for audit/edit fidelity."
```

---

## Task 3: Write Campaign Metadata in Timing-Compatible Shape (A2)

**Files:**
- Create: `src/lib/publishing/build-campaign-metadata.ts`
- Create: `tests/lib/publishing/build-campaign-metadata.test.ts`
- Modify: `src/app/actions/content.ts` — campaign insert in `createScheduledBatch()`

`extractCampaignTiming()` in `src/lib/scheduling/campaign-timing.ts` expects top-level `startDate`, `eventStart`, `endDate`, `dayOfWeek`, `time` fields. The wizard writes `{ brief, slotCount }` which breaks planner banner labels.

Do not change the campaign lifecycle state in this task. Existing create flows insert wizard campaigns with `status: 'scheduled'`; A2 only changes the `metadata` shape.

Also verify the campaign type string consumed by `extractCampaignTiming()`: weekly campaign timing currently checks `campaign_type === "weekly"`, while wizard content uses `contentType === "weekly_recurring"`. If `createScheduledBatch()` creates weekly campaigns, map the campaign row to `campaign_type: "weekly"` while leaving individual `content_items.content_type` as `weekly_recurring`.

- [ ] **Step 1: Write failing test for metadata builder**

Create `tests/lib/publishing/build-campaign-metadata.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildCampaignMetadata } from '@/lib/publishing/build-campaign-metadata';

describe('buildCampaignMetadata', () => {
  it('builds event metadata with top-level timing fields', () => {
    const result = buildCampaignMetadata('event', {
      title: 'Quiz Night',
      eventDate: '2026-06-15',
      eventTime: '19:30',
      eventEndDate: '2026-06-15',
    }, 3);

    expect(result).toMatchObject({
      startDate: '2026-06-15',
      startTime: '19:30',
      endDate: '2026-06-15',
      slotCount: 3,
    });
    expect(result.eventStart).toMatch(/^2026-06-15T19:30:00/);
    expect(result.brief).toBeDefined();
  });

  it('builds promotion metadata with endDate and offerSummary', () => {
    const result = buildCampaignMetadata('promotion', {
      title: 'Summer Sale',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      offerSummary: '2-for-1 drinks',
      couponCode: 'SUMMER26',
    }, 5);

    expect(result).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      offerSummary: '2-for-1 drinks',
      couponCode: 'SUMMER26',
      slotCount: 5,
    });
  });

  it('builds weekly metadata with dayOfWeek and time', () => {
    const result = buildCampaignMetadata('weekly_recurring', {
      title: 'Wine Wednesday',
      dayOfWeek: 3,
      time: '17:00',
      weeksAhead: 4,
    }, 4);

    expect(result).toMatchObject({
      dayOfWeek: 3,
      time: '17:00',
      weeksAhead: 4,
      slotCount: 4,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/publishing/build-campaign-metadata.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement buildCampaignMetadata**

Create `src/lib/publishing/build-campaign-metadata.ts`:

```typescript
import { DateTime } from 'luxon';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import type { ContentType } from '@/types/content';

export function buildCampaignMetadata(
  contentType: ContentType,
  brief: Record<string, unknown>,
  slotCount: number,
): Record<string, unknown> {
  const base = { brief, slotCount };

  if (contentType === 'event') {
    const eventDate = brief.eventDate as string | undefined;
    const eventTime = brief.eventTime as string | undefined;
    const eventEndDate = (brief.eventEndDate as string | undefined) ?? null;

    let eventStart: string | null = null;
    if (eventDate && eventTime) {
      const dt = DateTime.fromISO(`${eventDate}T${eventTime}`, { zone: DEFAULT_TIMEZONE });
      if (dt.isValid) eventStart = dt.toISO();
    }

    return {
      ...base,
      eventStart,
      startDate: eventDate ?? null,
      startTime: eventTime ?? null,
      endDate: eventEndDate,
    };
  }

  if (contentType === 'promotion') {
    return {
      ...base,
      startDate: (brief.startDate as string | undefined) ?? null,
      endDate: (brief.endDate as string | undefined) ?? null,
      offerSummary: (brief.offerSummary as string | undefined) ?? null,
      couponCode: (brief.couponCode as string | undefined) ?? null,
    };
  }

  if (contentType === 'weekly_recurring') {
    return {
      ...base,
      dayOfWeek: brief.dayOfWeek as number,
      time: brief.time as string,
      weeksAhead: (brief.weeksAhead as number | undefined) ?? 4,
    };
  }

  return base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/publishing/build-campaign-metadata.test.ts -v`
Expected: PASS

- [ ] **Step 5: Update createScheduledBatch to use the metadata builder**

In `src/app/actions/content.ts`, find the campaign insert block. Replace the metadata value:

```typescript
    import { buildCampaignMetadata } from '@/lib/publishing/build-campaign-metadata';

    // ... inside createScheduledBatch, campaign creation block ...

    if (needsCampaign) {
      const campaignName =
        (brief.title as string) ??
        (brief.eventTitle as string) ??
        `${contentType} campaign`;

      const metadata = buildCampaignMetadata(contentType, brief, slotCopies.length);
      const campaignType = contentType === 'weekly_recurring' ? 'weekly' : contentType;

      const { data: campaignRow, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
          account_id: accountId,
          name: campaignName,
          campaign_type: campaignType,
          status: 'scheduled',
          metadata,
        })
        .select('id')
        .single();
      // ... rest unchanged
    }
```

- [ ] **Step 6: Verify extractCampaignTiming compatibility**

Write a quick integration assertion in the metadata test:

```typescript
import { extractCampaignTiming } from '@/lib/scheduling/campaign-timing';

it('produces metadata that extractCampaignTiming can parse for events', () => {
  const metadata = buildCampaignMetadata('event', {
    title: 'Quiz Night',
    eventDate: '2026-06-15',
    eventTime: '19:30',
  }, 3);

  const timing = extractCampaignTiming({
    campaign_type: 'event',
    metadata,
  });

  expect(timing.campaignType).toBe('event');
  expect(timing.startAt.toISODate()).toBe('2026-06-15');
  expect(timing.startTime).toBe('19:30');
});
```

- [ ] **Step 7: Run tests and commit**

Run: `npx vitest run tests/lib/publishing/build-campaign-metadata.test.ts -v`
Expected: PASS

```bash
git add src/lib/publishing/build-campaign-metadata.ts tests/lib/publishing/build-campaign-metadata.test.ts src/app/actions/content.ts
git commit -m "fix(A2): write campaign metadata in timing-compatible shape

extractCampaignTiming() expects top-level startDate, eventStart, endDate,
dayOfWeek, time fields. Wizard was writing { brief, slotCount } which broke
planner proximity labels and publish-time banner text."
```

---

## Task 4: Fix Calendar Account Scoping and Signed Preview URLs (A3)

**Files:**
- Modify: `src/app/actions/content.ts` — `getCalendarItemsAction()`
- Modify: `src/features/create/steps/schedule-step.tsx` — fetch warning state

`getCalendarItemsAction()` uses the service-role client (bypasses RLS) but does not filter by `account_id`. It also returns `media_library.url` (wrong column) or `file_url` (a storage path, not a signed URL).

- [ ] **Step 1: Write test for account scoping**

Add to `tests/app/actions/content.test.ts`:

```typescript
describe('getCalendarItemsAction', () => {
  it('filters by account_id to prevent cross-account leakage', async () => {
    vi.mocked(requireAuthContext).mockResolvedValue({
      supabase: mockSupabase as never,
      accountId: 'acc-1',
      user: { id: 'user-1', email: 'test@test.com', accountId: 'acc-1', businessName: 'Test', timezone: 'Europe/London' },
    });

    mockSupabase.single.mockResolvedValue({ data: [], error: null });

    const { getCalendarItemsAction } = await import('@/app/actions/content');
    await getCalendarItemsAction('2026-06-01', '2026-06-30');

    const fromCalls = mockSupabase.from.mock.calls;
    const eqCalls = mockSupabase.eq.mock.calls;

    const accountFilter = eqCalls.find(
      ([col, val]: [string, string]) => col === 'account_id' && val === 'acc-1'
    );
    expect(accountFilter).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/actions/content.test.ts -t "getCalendarItemsAction" -v`
Expected: FAIL — no account_id filter found.

- [ ] **Step 3: Add account_id filter and fix media URL resolution**

In `src/app/actions/content.ts`, amend the existing `getCalendarItemsAction()` implementation. Do not replace it with a new `CalendarItem` shape. The `ScheduleCalendar` client already consumes the existing `CalendarItemDisplay` DTO with `scheduledFor`, `platform`, `status`, `placement`, `campaignName`, and `mediaPreview`.

Required implementation details:

- Destructure `{ supabase, accountId }` from `requireAuthContext()` and add `.eq('account_id', accountId)` to the `content_items` query.
- Preserve the current `scheduled_for` primary field and `scheduled_at` fallback. Do not filter only on `scheduled_at`.
- Keep returning signed `mediaPreview.url` server-side. The calendar shows existing planner content, not just media loaded into the current wizard, so the client cannot reliably resolve previews from `libraryItems`.
- The current `media_library.url` select is invalid for the schema. `media_library.file_url` stores the storage path as a compatibility value; prefer resolving previews via the same media asset IDs and signed-url flow used by `src/lib/planner/data.ts`, or query `media_assets` by the mirrored IDs and sign the selected preview path.
- Add a regression test that asserts the returned item still has `scheduledFor` and `mediaPreview`, not `scheduledAt`/`mediaIds`.

```typescript
export async function getCalendarItemsAction(
  startIso: string,
  endIso: string,
): Promise<{ data?: CalendarItemDisplay[]; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const { data: rows, error } = await supabase
      .from('content_items')
      .select(`
        id,
        platform,
        status,
        placement,
        campaign_name,
        scheduled_for,
        scheduled_at,
        content_media_attachments (
          media_id,
          position,
          media_library (
            id,
            file_url,
            file_type
          )
        )
      `)
      .eq('account_id', accountId)
      .or(`scheduled_for.gte.${startIso},scheduled_at.gte.${startIso}`)
      .or(`scheduled_for.lte.${endIso},scheduled_at.lte.${endIso}`)
      .not('status', 'eq', 'draft')
      .order('scheduled_for', { ascending: true, nullsFirst: false });

    if (error) {
      return { error: error.message };
    }

    // Keep the existing CalendarItemDisplay mapping. Resolve file_url/storage
    // paths to signed URLs before assigning mediaPreview.url.
    const items = await mapCalendarRowsWithSignedPreviews(rows ?? [], startIso, endIso, supabase);

    return { data: items };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Add non-blocking fetch warning to schedule-step**

In `src/features/create/steps/schedule-step.tsx`, find the `fetchExistingItems` / `loadExistingItems` function. Update to surface errors:

```typescript
  const [calendarWarning, setCalendarWarning] = useState<string | null>(null);

  // Inside the fetch function:
  const result = await getCalendarItemsAction(rangeStart, rangeEnd);
  if (result.error) {
    setCalendarWarning('Could not load existing posts. You may accidentally double-book.');
    // Preserve already-loaded months so one failed fetch does not blank the calendar.
    fetchedRangesRef.current.delete(monthKey);
  } else {
    setCalendarWarning(null);
    setExistingItems((prev) => {
      const existingIds = new Set(prev.map((i) => i.id));
      const newItems = (result.data ?? []).filter((i) => !existingIds.has(i.id));
      return newItems.length > 0 ? [...prev, ...newItems] : prev;
    });
  }
```

Add warning display above the calendar:

```tsx
  {calendarWarning && (
    <div
      className="flex items-start gap-2 rounded-lg p-3 text-sm"
      style={{ background: 'var(--c-orange-soft)', border: '1px solid var(--c-orange)', borderRadius: 'var(--r-lg)', color: 'var(--c-ink)' }}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--c-orange)' }} />
      <span>{calendarWarning}</span>
    </div>
  )}
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/app/actions/content.test.ts -v`
Expected: PASS

```bash
git add src/app/actions/content.ts src/features/create/steps/schedule-step.tsx
git commit -m "fix(A3): scope calendar queries to account and surface fetch warnings

getCalendarItemsAction used service-role client without account_id filter,
risking cross-account content leakage. Now filters by account_id and
returns structured errors that the schedule step displays as warnings."
```

---

## Task 5: Fix QStash Publish Payload — Signed URLs and Structured Details (B3)

**Files:**
- Create: `src/lib/publishing/resolve-media-urls.ts`
- Create: `tests/lib/publishing/resolve-media-urls.test.ts`
- Modify: `src/lib/publishing/handler.ts` — `buildContentPayload()`

`buildContentPayload()` passes raw `storage_path` values to providers. It also doesn't populate `eventDetails` or `offerDetails` for GBP.

This task is not complete if it only signs original storage paths. It must select the correct derived media for the job placement, render/upload a banner image when the resolved banner configuration is enabled, sign the final provider-facing paths, populate structured event/offer/CTA fields, and validate the payload before calling the adapter.

- [ ] **Step 1: Write test for media URL resolution**

Create `tests/lib/publishing/resolve-media-urls.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        createSignedUrls: vi.fn().mockResolvedValue({
          data: [
            { path: 'uploads/acc-1/image.jpg', signedUrl: 'https://storage.example.com/signed/image.jpg?token=abc' },
          ],
          error: null,
        }),
      })),
    },
  })),
}));

import { resolveMediaUrls } from '@/lib/publishing/resolve-media-urls';

describe('resolveMediaUrls', () => {
  it('returns signed URLs for storage paths', async () => {
    const result = await resolveMediaUrls(['uploads/acc-1/image.jpg']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('signed');
  });

  it('returns empty array for empty input', async () => {
    const result = await resolveMediaUrls([]);
    expect(result).toEqual([]);
  });

  it('uses batch signing when multiple paths are provided', async () => {
    // Assert Supabase storage.createSignedUrls receives all final paths in one call.
  });

  it('can sign a banner-rendered path instead of the original asset path', async () => {
    // Stub the banner render/upload helper and assert the signed URL is for that rendered path.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/publishing/resolve-media-urls.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement resolveMediaUrls**

Create `src/lib/publishing/resolve-media-urls.ts`:

```typescript
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const SIGNED_URL_EXPIRY_SECONDS = 3600;
const STORAGE_BUCKET = 'media';

export async function resolveMediaUrls(
  storagePaths: string[],
): Promise<string[]> {
  if (!storagePaths.length) return [];

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrls(storagePaths, SIGNED_URL_EXPIRY_SECONDS);

  if (error) {
    throw new Error(`Failed to sign media URLs: ${error.message}`);
  }

  const byPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry?.path && entry.signedUrl && !entry.error) {
      byPath.set(entry.path, entry.signedUrl);
    }
  }

  return storagePaths.map((path) => {
    const signedUrl = byPath.get(path);
    if (!signedUrl) {
      throw new Error(`Failed to sign media URL for path: ${path}`);
    }
    return signedUrl;
  });
}
```

Before wiring this into `buildContentPayload()`, add a small helper that produces the final storage paths to sign. It should reuse the existing derived-variant candidate logic from `src/lib/planner/data.ts` or factor that logic into a shared helper, choose story variants for story placement, resolve account banner defaults plus variant banner overrides with `bannerConfigResolver()`, and replace the first image path with the rendered banner path when banner config is enabled.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/publishing/resolve-media-urls.test.ts -v`
Expected: PASS

- [ ] **Step 5: Update buildContentPayload to sign URLs and add event/offer details**

In `src/lib/publishing/handler.ts`, replace `buildContentPayload()`:

```typescript
import { resolveMediaUrls } from './resolve-media-urls';

async function buildContentPayload(
  db: ReturnType<typeof createServiceSupabaseClient>,
  contentItemId: string,
): Promise<ContentPayload> {
  const { data: variant } = await db
    .from('content_variants')
    .select('body, media_ids, preview_data')
    .eq('content_item_id', contentItemId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: item } = await db
    .from('content_items')
    .select('content_type, campaign_id, placement')
    .eq('id', contentItemId)
    .single();

  const contentType = (item?.content_type ?? 'instant_post') as ContentPayload['contentType'];
  const text = (variant?.body as string) ?? '';
  const mediaIds = (variant?.media_ids as string[]) ?? [];

  let campaignMetadata: Record<string, unknown> | null = null;
  if (item?.campaign_id && (contentType === 'event' || contentType === 'promotion')) {
    const { data: campaign } = await db
      .from('campaigns')
      .select('metadata')
      .eq('id', item.campaign_id)
      .single();

    campaignMetadata = (campaign?.metadata ?? {}) as Record<string, unknown>;
  }

  // Resolve final media paths to signed URLs. The helper must account for
  // placement-specific derivatives and banner-rendered replacements.
  let mediaUrls: string[] | undefined;
  if (mediaIds.length > 0) {
    const { data: mediaAssets } = await db
      .from('media_assets')
      .select('storage_path')
      .in('id', mediaIds);

    const storagePaths = await resolveFinalPublishMediaPaths({
      db,
      contentItemId,
      mediaAssets: mediaAssets ?? [],
      placement: item?.placement,
      variant,
      campaignMetadata,
    });
    const signed = await resolveMediaUrls(storagePaths);
    mediaUrls = signed.length > 0 ? signed : undefined;
  }

  // Build event/offer details from campaign metadata
  let eventDetails: ContentPayload['eventDetails'];
  let offerDetails: ContentPayload['offerDetails'];

  if (campaignMetadata && (contentType === 'event' || contentType === 'promotion')) {
    const meta = campaignMetadata;

    if (contentType === 'event') {
      eventDetails = {
        title: (meta.brief as Record<string, unknown>)?.title as string ?? '',
        startDate: (meta.eventStart as string) ?? (meta.startDate as string) ?? '',
        endDate: (meta.endDate as string) ?? (meta.startDate as string) ?? '',
      };
    }

    if (contentType === 'promotion') {
      const brief = (meta.brief ?? {}) as Record<string, unknown>;
      offerDetails = {
        couponCode: (meta.couponCode as string) ?? (brief.couponCode as string) ?? '',
        redeemUrl: (brief.redeemUrl as string) ?? undefined,
        terms: (brief.terms as string) ?? undefined,
      };
    }
  }

  // GBP CTA from preview_data. If the GBP API adapter supports CTA fields,
  // extend ContentPayload and the adapter rather than leaving this as a comment.
  const previewData = (variant?.preview_data ?? {}) as Record<string, unknown>;
  const structuredCopy = previewData.structuredCopy as Record<string, unknown> | undefined;
  if (structuredCopy?.ctaAction && !eventDetails && !offerDetails) {
    // payload.callToAction = structuredCopy.ctaAction as string;
  }

  return {
    text,
    mediaUrls,
    contentType,
    eventDetails,
    offerDetails,
  };
}
```

- [ ] **Step 5b: Validate before publishing**

In `processPublishJob()`, immediately after `const payload = await buildContentPayload(...)` and before selecting `publishPost`/`publishStory`/GBP methods, call `adapter.validate(payload)`. If validation fails, throw a non-retryable `ProviderError` with `ErrorClassification.CONTENT_REJECTED` so invalid payloads fail cleanly instead of repeatedly retrying provider calls.

```typescript
  const validation = adapter.validate(payload);
  if (!validation.valid) {
    throw new ProviderError(
      validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      typedJob.platform,
      ErrorClassification.CONTENT_REJECTED,
      false,
      undefined,
      validation.errors,
    );
  }
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- --run`
Expected: PASS

```bash
git add src/lib/publishing/resolve-media-urls.ts tests/lib/publishing/resolve-media-urls.test.ts src/lib/publishing/handler.ts src/types/providers.ts src/lib/providers/gbp/adapter.ts
git commit -m "fix(B3): sign media URLs and populate event/offer details in publish payload

buildContentPayload was passing raw storage_path values to provider APIs.
Now signs URLs via Supabase storage and populates eventDetails/offerDetails
from campaign metadata for GBP event/offer publishing."
```

---

# Wave 1: Security

## Task 6: Add Account Guards to Service-Role Server Actions (B2)

**Files:**
- Modify: `src/app/actions/content.ts` — `getDraft()`, `listDrafts()`
- Modify: `src/app/actions/media.ts` — `attachMediaToContent()`
- Modify: `src/lib/link-in-bio/profile.ts` — `reorderLinkInBioTiles()`

- [ ] **Step 1: Write test for getDraft account scoping**

Add to `tests/app/actions/content.test.ts`:

```typescript
describe('getDraft', () => {
  it('includes account_id filter in query', async () => {
    mockSupabase.single.mockResolvedValueOnce({ data: { id: 'ci-1', account_id: 'acc-1' }, error: null });

    const { getDraft } = await import('@/app/actions/content');
    await getDraft('ci-1');

    const eqCalls = mockSupabase.eq.mock.calls;
    expect(eqCalls).toContainEqual(['account_id', 'acc-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/actions/content.test.ts -t "getDraft" -v`
Expected: FAIL — no account_id filter.

- [ ] **Step 3: Fix getDraft — add account filter**

In `src/app/actions/content.ts`, find `getDraft()`:

```typescript
export async function getDraft(
  contentId: string,
): Promise<{ data?: ContentItem; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('id', contentId)
      .eq('account_id', accountId)  // ADD THIS LINE
      .single();

    if (error) {
      return { error: error.message };
    }

    return { data: mapContentItem(data as Record<string, unknown>) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Fix listDrafts — add account filter**

In `src/app/actions/content.ts`, find `listDrafts()`. Add `.eq('account_id', accountId)`:

```typescript
export async function listDrafts(): Promise<{ data?: ContentItem[]; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const { data, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('account_id', accountId)  // ADD THIS LINE
      .eq('status', 'draft')
      .order('updated_at', { ascending: false });

    // ... rest unchanged
  }
}
```

- [ ] **Step 5: Fix attachMediaToContent — validate ownership**

In `src/app/actions/media.ts`, find `attachMediaToContent()`. Add ownership checks:

```typescript
export async function attachMediaToContent(
  contentItemId: string,
  mediaIds: string[],
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    // Verify content item belongs to this account
    const { data: item, error: itemError } = await supabase
      .from('content_items')
      .select('id')
      .eq('id', contentItemId)
      .eq('account_id', accountId)
      .single();

    if (itemError || !item) {
      return { error: 'Content item not found or access denied' };
    }

    // Verify all media-library assets belong to this account. The attachment
    // table references media_library, not media_assets, in the v2 schema.
    if (mediaIds.length > 0) {
      const { data: ownedMedia, error: mediaError } = await supabase
        .from('media_library')
        .select('id')
        .in('id', mediaIds)
        .eq('account_id', accountId);

      if (mediaError) {
        return { error: 'Failed to verify media ownership' };
      }

      const ownedIds = new Set((ownedMedia ?? []).map((m: { id: string }) => m.id));
      const unowned = mediaIds.filter((id) => !ownedIds.has(id));
      if (unowned.length > 0) {
        return { error: 'Some media assets do not belong to this account' };
      }
    }

    // ... proceed with existing attachment logic
  }
}
```

- [ ] **Step 6: Fix reorderLinkInBioTiles — validate tile ownership before upsert**

`src/lib/link-in-bio/profile.ts` currently upserts arbitrary IDs with the authenticated `account_id`. Before calling `.upsert()`, select existing `link_in_bio_tiles.id` for `tileIdsInOrder` scoped by `account_id`. Reject the reorder if any requested ID is missing from the owned set. Do not allow an upsert to create new tile IDs during reorder.

```typescript
  const { data: ownedTiles, error: ownedError } = await supabase
    .from("link_in_bio_tiles")
    .select("id")
    .eq("account_id", accountId)
    .in("id", input.tileIdsInOrder);

  if (ownedError) {
    throw ownedError;
  }

  const ownedIds = new Set((ownedTiles ?? []).map((tile) => tile.id));
  const unownedIds = input.tileIdsInOrder.filter((tileId) => !ownedIds.has(tileId));
  if (unownedIds.length > 0) {
    throw new Error("One or more link-in-bio tiles were not found for this account");
  }
```

- [ ] **Step 7: Run tests and commit**

Run: `npm test -- --run`
Expected: PASS

```bash
git add src/app/actions/content.ts src/app/actions/media.ts src/lib/link-in-bio/profile.ts
git commit -m "fix(B2): add account_id guards to service-role server actions

getDraft, listDrafts, attachMediaToContent, and link-in-bio tile reorder
used service-role paths without complete ownership checks. Since
service-role bypasses RLS, these could leak or mutate cross-account data."
```

---

## Task 7: Centralise Cron Route Authentication (B5)

**Files:**
- Create: `src/lib/security/cron-auth.ts`
- Create: `tests/lib/security/cron-auth.test.ts`
- Modify: all cron route files that currently validate `CRON_SECRET`

- [ ] **Step 1: Write failing test for cron auth utility**

Create `tests/lib/security/cron-auth.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyCronAuth } from '@/lib/security/cron-auth';

function makeRequest(headers: Record<string, string> = {}, url = 'https://app.com/api/cron/test'): Request {
  return new Request(url, { headers });
}

describe('verifyCronAuth', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret-abc');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts valid Bearer authorization header', () => {
    const req = makeRequest({ authorization: 'Bearer test-secret-abc' });
    const result = verifyCronAuth(req);
    expect(result.authorised).toBe(true);
  });

  it('accepts valid x-cron-secret header', () => {
    const req = makeRequest({ 'x-cron-secret': 'test-secret-abc' });
    const result = verifyCronAuth(req);
    expect(result.authorised).toBe(true);
  });

  it('rejects URL-only secret', () => {
    const req = makeRequest({}, 'https://app.com/api/cron/test?secret=test-secret-abc');
    const result = verifyCronAuth(req);
    expect(result.authorised).toBe(false);
  });

  it('rejects missing secret', () => {
    const req = makeRequest();
    const result = verifyCronAuth(req);
    expect(result.authorised).toBe(false);
  });

  it('rejects wrong secret', () => {
    const req = makeRequest({ authorization: 'Bearer wrong-secret' });
    const result = verifyCronAuth(req);
    expect(result.authorised).toBe(false);
  });

  it('returns error response when CRON_SECRET is not configured', () => {
    vi.stubEnv('CRON_SECRET', '');
    const req = makeRequest({ authorization: 'Bearer test-secret-abc' });
    const result = verifyCronAuth(req);
    expect(result.authorised).toBe(false);
    expect(result.errorStatus).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/security/cron-auth.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement verifyCronAuth**

Create `src/lib/security/cron-auth.ts`:

```typescript
import { validateSecret } from './signing';

interface CronAuthResult {
  authorised: boolean;
  errorStatus?: number;
  errorMessage?: string;
}

export function verifyCronAuth(request: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      authorised: false,
      errorStatus: 500,
      errorMessage: 'CRON_SECRET not configured',
    };
  }

  // Accept Authorization: Bearer <secret> (Vercel's format)
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.replace(/^Bearer\s+/i, '').trim() ?? null;

  // Accept x-cron-secret header for local/manual invocations
  const xCronSecret = request.headers.get('x-cron-secret')?.trim() ?? null;

  const provided = bearerToken || xCronSecret;

  if (!provided || !validateSecret(provided, cronSecret)) {
    return {
      authorised: false,
      errorStatus: 401,
      errorMessage: 'Unauthorized',
    };
  }

  return { authorised: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/security/cron-auth.test.ts -v`
Expected: PASS

- [ ] **Step 5: Update publish-scheduler cron route to use shared auth**

In `src/app/api/cron/publish-scheduler/route.ts`, replace the inline auth block:

```typescript
import { verifyCronAuth } from '@/lib/security/cron-auth';

// ... inside handle():

  const auth = verifyCronAuth(request);
  if (!auth.authorised) {
    return NextResponse.json(
      { error: auth.errorMessage },
      { status: auth.errorStatus ?? 401 },
    );
  }
```

Remove the old `normaliseAuthHeader`, `cronSecret`, `xCronSecret`, `authHeader`, `headerSecret`, `urlSecret` variables.

- [ ] **Step 6: Update remaining cron routes**

Apply the same pattern to each cron route file:
- `src/app/api/cron/purge-trash/route.ts`
- `src/app/api/cron/sync-meta-campaigns/route.ts`
- `src/app/api/cron/optimise-meta-campaigns/route.ts`
- `src/app/api/cron/sync-gbp-reviews/route.ts`
- `src/app/api/cron/notify-failures/route.ts`
- `src/app/api/cron/notify-expiring-connections/route.ts`
- `src/app/api/cron/gbp-metrics/route.ts` if retained
- `src/app/api/cron/recurring-publish/route.ts` if retained
- `src/app/api/cron/token-health/route.ts` if retained

Each route: import `verifyCronAuth`, replace inline auth, remove dead code.

- [ ] **Step 7: Run existing cron tests and full suite**

Run: `npx vitest run tests/lib/security/cron-auth.test.ts -v && npm test -- --run`
Expected: PASS. Add route-specific tests under `tests/app/api/cron/` if any route has non-trivial auth branching beyond the shared helper.

- [ ] **Step 8: Commit**

```bash
git add src/lib/security/cron-auth.ts tests/lib/security/cron-auth.test.ts src/app/api/cron/
git commit -m "fix(B5): centralise cron auth — timing-safe, header-only, no URL secrets

Replaces 7 duplicated auth blocks with shared verifyCronAuth().
Uses timing-safe comparison via validateSecret(). Accepts Bearer header
(Vercel format) and x-cron-secret (local/manual). Drops URL query secret."
```

---

## Task 8: Wire QStash Failure Callback (B6)

**Files:**
- Modify: `src/lib/publishing/dispatch.ts`
- Test: `tests/lib/publishing/dispatch.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `tests/lib/publishing/dispatch.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

const mockPublishJSON = vi.fn().mockResolvedValue({ messageId: 'msg-1' });

vi.mock('@/lib/qstash/client', () => ({
  getQStashClient: () => ({ publishJSON: mockPublishJSON }),
}));

vi.mock('@/env', () => ({
  env: {
    client: { NEXT_PUBLIC_SITE_URL: 'https://app.cheersai.com' },
  },
}));

import { dispatchToQStash } from '@/lib/publishing/dispatch';

describe('dispatchToQStash', () => {
  it('sets failureCallback URL', async () => {
    await dispatchToQStash({
      jobId: 'job-1',
      deduplicationId: 'dedup-1',
    });

    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCallback: 'https://app.cheersai.com/api/webhooks/qstash-publish/failure',
      }),
    );
  });

  it('includes jobId in body', async () => {
    await dispatchToQStash({ jobId: 'job-1', deduplicationId: 'dedup-1' });

    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { jobId: 'job-1' },
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/publishing/dispatch.test.ts -v`
Expected: FAIL — no `failureCallback` in the call.

- [ ] **Step 3: Add failureCallback to dispatchToQStash**

In `src/lib/publishing/dispatch.ts`:

```typescript
export async function dispatchToQStash({ jobId, deduplicationId, delaySeconds }: DispatchOptions): Promise<void> {
  const client = getQStashClient();
  const baseUrl = env.client.NEXT_PUBLIC_SITE_URL;

  await client.publishJSON({
    url: `${baseUrl}/api/webhooks/qstash-publish`,
    body: { jobId },
    retries: 3,
    headers: {
      'Upstash-Forward-Content-Type': 'application/json',
    },
    deduplicationId,
    failureCallback: `${baseUrl}/api/webhooks/qstash-publish/failure`,
    ...(delaySeconds && delaySeconds > 0 ? { delay: delaySeconds } : {}),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/publishing/dispatch.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/publishing/dispatch.ts tests/lib/publishing/dispatch.test.ts
git commit -m "fix(B6): wire QStash failureCallback to publish failure handler

dispatchToQStash was not setting failureCallback, so the existing
/api/webhooks/qstash-publish/failure handler could never fire.
Now QStash sends exhausted-retry notifications to the failure endpoint."
```

---

## Task 9: Lock Down Supabase Edge Functions (B1)

**Files:**
- Modify: `supabase/config.toml`

The Supabase `publish-queue`, `materialise-weekly`, and `media-derivatives` Edge Functions have `verify_jwt = false`. Since the active publish path uses QStash + Next.js, these are either retired or legacy.

- [ ] **Step 1: Verify these functions are not called by active code**

Run: `rg -n 'publish-queue|materialise-weekly|media-derivatives' src scripts vercel.json -g '*.ts' -g '*.tsx' -g '*.json' -g '!*.test.ts' -g '!*.spec.ts'`
Expected: No active invocations from the app, scripts, or cron config.

- [ ] **Step 2: Disable the functions in config.toml**

In `supabase/config.toml`, for each function block, set `verify_jwt = true`:

```toml
[functions.publish-queue]
verify_jwt = true

[functions.materialise-weekly]
verify_jwt = true

[functions.media-derivatives]
verify_jwt = true
```

- [ ] **Step 3: Commit**

```bash
git add supabase/config.toml
git commit -m "fix(B1): enable JWT verification on legacy Supabase Edge Functions

publish-queue, materialise-weekly, and media-derivatives had verify_jwt=false.
Active publish path uses QStash + Next.js. Enabling JWT verification
prevents unauthenticated invocation of these legacy functions."
```

If any active caller still invokes these functions without a Supabase JWT, do not ship this as a config-only change. Either retire the function path completely or add a shared header-signature/cron-secret gate to the function before changing deployment config.

---

# Wave 2: Create UX

## Task 10: Infer Labels for Manual Event and Promotion Slots (A4)

**Files:**
- Create: `src/features/create/schedule/infer-slot-label.ts`
- Create: `tests/features/create/schedule/infer-slot-label.test.ts`
- Modify: `src/features/create/steps/schedule-step.tsx`

- [ ] **Step 1: Write failing test for label inference**

Create `tests/features/create/schedule/infer-slot-label.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { inferSlotLabel } from '@/features/create/schedule/infer-slot-label';

describe('inferSlotLabel', () => {
  it('returns "Event day" for event date match', () => {
    const label = inferSlotLabel(
      { contentType: 'event', eventDate: '2026-06-15' },
      '2026-06-15',
    );
    expect(label).toBe('Event day');
  });

  it('returns "Last chance" for promotion end date match', () => {
    const label = inferSlotLabel(
      { contentType: 'promotion', endDate: '2026-06-30' },
      '2026-06-30',
    );
    expect(label).toBe('Last chance');
  });

  it('returns undefined for non-matching date', () => {
    const label = inferSlotLabel(
      { contentType: 'event', eventDate: '2026-06-15' },
      '2026-06-14',
    );
    expect(label).toBeUndefined();
  });

  it('returns undefined for instant_post', () => {
    const label = inferSlotLabel(
      { contentType: 'instant_post' },
      '2026-06-15',
    );
    expect(label).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/features/create/schedule/infer-slot-label.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement inferSlotLabel**

Create `src/features/create/schedule/infer-slot-label.ts`:

```typescript
interface BriefContext {
  contentType: string;
  eventDate?: string;
  endDate?: string;
}

export function inferSlotLabel(
  brief: BriefContext,
  slotDate: string,
): string | undefined {
  if (brief.contentType === 'event' && brief.eventDate === slotDate) {
    return 'Event day';
  }

  if (brief.contentType === 'promotion' && brief.endDate === slotDate) {
    return 'Last chance';
  }

  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/features/create/schedule/infer-slot-label.test.ts -v`
Expected: PASS

- [ ] **Step 5: Use inferSlotLabel in schedule-step handleAddSlot**

In `src/features/create/steps/schedule-step.tsx`, update `handleAddSlot`:

```typescript
import { inferSlotLabel } from '@/features/create/schedule/infer-slot-label';

// Inside handleAddSlot, after matching suggestions:
      const matchedSuggestion = suggestions.find(
        (s) => s.date === date && s.time === time,
      );

      const label = matchedSuggestion?.label
        ?? inferSlotLabel(contentBrief, date);

      const newSlot: ScheduleSlot = {
        key: matchedSuggestion
          ? `suggestion:${matchedSuggestion.id}:${date}:${time}`
          : `manual:${date}:${time}`,
        date,
        time,
        label,
        source: matchedSuggestion ? 'suggestion' : 'manual',
        suggestionId: matchedSuggestion?.id,
      };
```

Apply the same change in the story replacement branch.

- [ ] **Step 6: Run tests and commit**

```bash
git add src/features/create/schedule/infer-slot-label.ts tests/features/create/schedule/infer-slot-label.test.ts src/features/create/steps/schedule-step.tsx
git commit -m "feat(A4): infer semantic labels for manual event and promotion slots

Manual custom slots now get 'Event day' or 'Last chance' labels when
their date matches the brief's event date or promotion end date.
Labels flow to AI generation for contextually appropriate copy."
```

---

## Task 11: Strengthen Temporal AI Prompting (A6)

**Files:**
- Create: `src/lib/ai/temporal-instructions.ts`
- Create: `tests/lib/ai/temporal-instructions.test.ts`
- Modify: `src/lib/ai/prompts.ts`

- [ ] **Step 1: Write failing test for temporal instructions**

Create `tests/lib/ai/temporal-instructions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTemporalInstructions } from '@/lib/ai/temporal-instructions';

describe('buildTemporalInstructions', () => {
  it('returns present-tense instruction for Event day', () => {
    const result = buildTemporalInstructions('Event day');
    expect(result).toContain('present tense');
    expect(result).toContain('today');
  });

  it('returns countdown instruction for N days to go', () => {
    const result = buildTemporalInstructions('2 days to go');
    expect(result).toContain('remaining time');
  });

  it('returns urgency instruction for Last chance', () => {
    const result = buildTemporalInstructions('Last chance');
    expect(result).toContain('deadline');
  });

  it('returns empty string for undefined label', () => {
    const result = buildTemporalInstructions(undefined);
    expect(result).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ai/temporal-instructions.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement buildTemporalInstructions**

Create `src/lib/ai/temporal-instructions.ts`:

```typescript
export function buildTemporalInstructions(slotLabel?: string): string {
  if (!slotLabel) return '';

  const lower = slotLabel.toLowerCase();

  if (lower === 'event day') {
    return [
      `Temporal framing: This post goes live on the event day.`,
      `Use present tense. Say "today" or "tonight" where natural.`,
      `Avoid future-tense phrasing like "coming up" or "this weekend".`,
      `Create immediacy — the event is happening NOW.`,
    ].join('\n');
  }

  if (lower === 'last chance') {
    return [
      `Temporal framing: This is the final post before a promotion ends.`,
      `Communicate clear deadline urgency without misleading scarcity.`,
      `Use phrases like "last day", "ends today", "don't miss out".`,
      `Avoid false urgency — be factual about the deadline.`,
    ].join('\n');
  }

  const countdownMatch = lower.match(/^(\d+)\s+(day|week)s?\s+to\s+go$/);
  if (countdownMatch) {
    const [, count, unit] = countdownMatch;
    return [
      `Temporal framing: This post is a countdown — ${count} ${unit}(s) until the event.`,
      `Naturally reference the remaining time without contradicting the scheduled date.`,
      `Build anticipation. Use forward-looking language like "just ${count} ${unit}s away".`,
    ].join('\n');
  }

  if (lower.includes('hype') || lower.includes('week')) {
    return [
      `Temporal framing: "${slotLabel}" — a lead-up post building anticipation.`,
      `Use forward-looking language. Mention the upcoming event naturally.`,
    ].join('\n');
  }

  return `Slot purpose: "${slotLabel}" — write copy that fits this narrative moment.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ai/temporal-instructions.test.ts -v`
Expected: PASS

- [ ] **Step 5: Integrate into buildUserPrompt**

In `src/lib/ai/prompts.ts`, find the `buildUserPrompt()` function. Replace the simple slot-label line:

```typescript
import { buildTemporalInstructions } from './temporal-instructions';

// Inside buildUserPrompt, find the block that handles context.slotLabel:
  if (context?.slotLabel) {
    const temporal = buildTemporalInstructions(context.slotLabel);
    if (temporal) {
      sections.push(temporal);
    }
  }
```

Remove the old line: `sections.push(\`Slot purpose: "${context.slotLabel}" - write copy that fits this narrative moment.\`);`

- [ ] **Step 6: Run existing AI prompt tests**

Run: `npx vitest run tests/lib/ai -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/temporal-instructions.ts tests/lib/ai/temporal-instructions.test.ts src/lib/ai/prompts.ts
git commit -m "feat(A6): strengthen temporal AI prompting with label-specific instructions

Event day posts now get present-tense instructions, countdown posts
reference remaining time naturally, and Last chance posts use factual
deadline urgency. Replaces generic slot purpose string."
```

---

## Task 12: Include Labels in Staleness Detection (A11)

**Files:**
- Modify: `src/features/create/create-wizard.tsx`

- [ ] **Step 1: Update staleness comparison to include labels**

In `src/features/create/create-wizard.tsx`, find the `isContextStale` prop passed to `GenerateStep`. Replace:

```typescript
isContextStale={
  lastGenerationContext !== null && (
    JSON.stringify([...lastGenerationContext.mediaIds].sort()) !== JSON.stringify([...selectedMediaIds].sort()) ||
    JSON.stringify(lastGenerationContext.slots.map(s => `${s.date}:${s.time}`).sort()) !== JSON.stringify(selectedSlots.map(s => `${s.date}:${s.time}`).sort())
  )
}
```

With:

```typescript
isContextStale={
  lastGenerationContext !== null && (
    JSON.stringify([...lastGenerationContext.mediaIds].sort()) !== JSON.stringify([...selectedMediaIds].sort()) ||
    JSON.stringify(lastGenerationContext.slots.map(s => `${s.key}:${s.date}:${s.time}:${s.label ?? ''}`).sort()) !==
    JSON.stringify(selectedSlots.map(s => `${s.key}:${s.date}:${s.time}:${s.label ?? ''}`).sort())
  )
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS

```bash
git add src/features/create/create-wizard.tsx
git commit -m "fix(A11): include slot labels and keys in staleness detection

Previously only compared date:time, missing label changes that alter
AI generation prompts. Now compares key, date, time, and label."
```

---

## Task 13: Replace Freeform Time Input with Preset Buttons (A5)

**Files:**
- Modify: `src/features/create/schedule/schedule-calendar.tsx`

- [ ] **Step 1: Add TIME_PRESETS constant and replace the pending slot UI**

In `src/features/create/schedule/schedule-calendar.tsx`, add at the top of the file:

```typescript
const TIME_PRESETS = [
  { time: '07:00', label: '7am' },
  { time: '11:00', label: '11am' },
  { time: '14:00', label: '2pm' },
  { time: '17:00', label: '5pm' },
  { time: '21:00', label: '9pm' },
] as const;

const MIN_LEAD_MINUTES = 30;
```

Replace the pending slot `<input type="time">` block (the `isPending` branch) with:

```tsx
                ) : isPending ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {TIME_PRESETS.map((preset) => {
                        const slotDt = DateTime.fromISO(`${isoDate}T${preset.time}`, { zone: timezone });
                        const minDt = DateTime.now().setZone(timezone).plus({ minutes: MIN_LEAD_MINUTES });
                        const isDisabled = slotDt <= minDt;
                        const isAlreadySelected = selectedKeySet.has(`${isoDate}|${preset.time}`);

                        return (
                          <button
                            key={preset.time}
                            type="button"
                            disabled={isDisabled || isAlreadySelected}
                            onClick={() => {
                              onAddSlot({ date: isoDate, time: preset.time });
                              setPendingSlot(null);
                            }}
                            className="rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            style={{
                              borderColor: 'var(--c-line)',
                              color: isDisabled || isAlreadySelected ? 'var(--c-ink-3)' : 'var(--c-ink)',
                              backgroundColor: 'white',
                            }}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    {TIME_PRESETS.every((preset) => {
                      const slotDt = DateTime.fromISO(`${isoDate}T${preset.time}`, { zone: timezone });
                      const minDt = DateTime.now().setZone(timezone).plus({ minutes: MIN_LEAD_MINUTES });
                      return slotDt <= minDt;
                    }) && (
                      <p className="text-[10px]" style={{ color: 'var(--c-ink-3)' }}>No times available today</p>
                    )}
                    <button
                      type="button"
                      onClick={cancelPending}
                      aria-label="Close time presets"
                      className="absolute right-2 top-2 rounded-full p-0.5 transition hover:bg-black/5"
                      style={{ color: 'var(--c-ink-3)' }}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
```

- [ ] **Step 2: Add X import if missing**

```typescript
import { X } from 'lucide-react';
```

- [ ] **Step 3: Typecheck and visually verify**

Run: `npm run typecheck`
Expected: PASS

Start dev server and navigate to the create wizard schedule step. Verify preset buttons appear when clicking "Add custom slot" on a day, and that past-time presets are disabled for today.

- [ ] **Step 4: Commit**

```bash
git add src/features/create/schedule/schedule-calendar.tsx
git commit -m "feat(A5): replace freeform time input with preset time buttons

Two-click scheduling: click a day, then click a preset time button.
Past-time presets are disabled for today. Shows 'No times available today'
when all presets are in the past."
```

---

## Task 14: Add Media and Banner Preview to Generate Step (A7)

**Files:**
- Modify: `src/features/create/create-modal-actions.ts` — return banner defaults
- Modify: `src/features/create/create-wizard.tsx` — pass media/banner data
- Modify: `src/features/create/steps/generate-step.tsx` — render preview

- [ ] **Step 1: Return banner defaults from getCreateModalData**

In `src/features/create/create-modal-actions.ts`:

```typescript
export async function getCreateModalData() {
    const [mediaAssets, ownerSettings] = await Promise.all([
        listMediaAssets({ excludeTags: ["Tournament"] }),
        getOwnerSettings(),
    ]);

    const timezone = ownerSettings.posting.timezone ?? DEFAULT_TIMEZONE;
    const now = DateTime.now().setZone(timezone);
    const rangeStart = now.startOf("month").toUTC().toJSDate();
    const rangeEnd = now.plus({ months: 2 }).endOf("month").toUTC().toJSDate();

    const plannerOverview = await getPlannerOverview({
        rangeStart,
        rangeEnd,
        includeActivity: false,
        includeTrash: false,
    });

    // Extract banner defaults from posting settings. getOwnerSettings()
    // exposes camelCase values under posting.bannerDefaults, while
    // bannerConfigResolver expects DB-shaped snake_case keys.
    const posting = ownerSettings.posting.bannerDefaults;
    const bannerDefaults = {
      banners_enabled: posting.bannersEnabled ?? false,
      banner_position: (posting.bannerPosition ?? 'bottom') as 'top' | 'bottom' | 'left' | 'right',
      banner_bg: posting.bannerBg ?? '#111827',
      banner_text_colour: posting.bannerTextColour ?? '#ffffff',
    };

    return {
        mediaAssets,
        plannerItems: plannerOverview.items,
        ownerTimezone: timezone,
        bannerDefaults,
    };
}
```

- [ ] **Step 2: Pass media preview and banner config to GenerateStep**

In `src/features/create/create-wizard.tsx`, update the state and props:

```typescript
import type { AccountBannerDefaults } from '@/lib/banner/config';

// Add state
const [bannerDefaults, setBannerDefaults] = useState<AccountBannerDefaults | null>(null);

// In the data loading effect where getCreateModalData is called:
const data = await getCreateModalData();
setLibraryItems(data.mediaAssets);
if (data.bannerDefaults) {
  setBannerDefaults(data.bannerDefaults);
}
```

Update the `GenerateStep` render:

```tsx
<GenerateStep
  // ... existing props ...
  libraryItems={libraryItems}
  bannerDefaults={bannerDefaults}
/>
```

- [ ] **Step 3: Update GenerateStep props and render preview**

In `src/features/create/steps/generate-step.tsx`, add props:

```typescript
import { BannerOverlay } from '@/features/planner/banner-overlay';
import { bannerConfigResolver } from '@/lib/banner/config';
import type { AccountBannerDefaults } from '@/lib/banner/config';
import type { MediaAssetSummary } from '@/lib/library/data';

interface GenerateStepProps {
  // ... existing props ...
  libraryItems?: MediaAssetSummary[];
  bannerDefaults?: AccountBannerDefaults | null;
}
```

Inside the component, derive the preview:

```typescript
  const firstMediaItem = useMemo(() => {
    if (!libraryItems?.length || !selectedMediaIds.length) return null;
    return libraryItems.find((item) => item.id === selectedMediaIds[0]) ?? null;
  }, [libraryItems, selectedMediaIds]);

  const bannerConfig = useMemo(() => {
    if (!bannerDefaults) return null;
    return bannerConfigResolver(bannerDefaults, {
      banner_enabled: null,
      banner_text_override: null,
      banner_position: null,
      banner_bg: null,
      banner_text_colour: null,
    });
  }, [bannerDefaults]);
```

Add to the card header area (before the platform copy):

```tsx
  {firstMediaItem && firstMediaItem.mediaType === 'image' && firstMediaItem.previewUrl && (
    <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-lg bg-muted">
      {bannerConfig?.enabled && firstMediaItem.previewUrl ? (
        <BannerOverlay
          mediaUrl={firstMediaItem.previewUrl}
          config={bannerConfig}
          label={slot.label ?? contentBrief.title}
          className="size-full"
        />
      ) : (
        <img
          src={firstMediaItem.previewUrl}
          alt=""
          className="size-full object-cover"
        />
      )}
    </div>
  )}
  {firstMediaItem && firstMediaItem.mediaType === 'video' && (
    <div className="mb-3 flex aspect-video w-full items-center justify-center rounded-lg bg-muted">
      <span className="text-xs text-muted-foreground">Video preview not available</span>
    </div>
  )}
```

- [ ] **Step 4: Typecheck and visually verify**

Run: `npm run typecheck`
Start dev server. Create a post with media selected, advance to Generate. Verify image preview with banner overlay appears.

- [ ] **Step 5: Commit**

```bash
git add src/features/create/create-modal-actions.ts src/features/create/create-wizard.tsx src/features/create/steps/generate-step.tsx
git commit -m "feat(A7): add media and banner preview to generate step

Review cards now show the first selected image with BannerOverlay when
banners are enabled. Video media shows a placeholder. Banner config
uses account defaults with no post overrides (variants don't exist yet)."
```

---

## Task 15: Auto-Expand Body Textareas (A8)

**Files:**
- Modify: `src/features/create/steps/generate-step.tsx`

- [ ] **Step 1: Add auto-resize behavior to textareas**

In `src/features/create/steps/generate-step.tsx`, add a ref callback helper:

```typescript
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
```

Replace the existing textarea elements. Find `rows={4}` and `resize-none`:

```tsx
  <textarea
    ref={autoResize}
    className="w-full rounded-lg border bg-background px-3 py-2 text-sm max-h-[50vh] overflow-y-auto"
    style={{ borderColor: 'var(--c-line)', minHeight: '4.5rem' }}
    value={copy.body}
    onChange={(e) => {
      handleCopyEdit(slot.key, platform, 'body', e.target.value);
      autoResize(e.target);
    }}
  />
```

- [ ] **Step 2: Typecheck and verify**

Run: `npm run typecheck`
Visually verify textareas auto-expand with content.

- [ ] **Step 3: Commit**

```bash
git add src/features/create/steps/generate-step.tsx
git commit -m "feat(A8): auto-expand body textareas in generate step

Replaces fixed rows=4 resize-none with auto-grow behavior.
Min height 4.5rem, max-h-[50vh] with overflow-y-auto safety cap."
```

---

## Task 16: Remove Nested Scroll from Generated Review Cards (A9)

**Files:**
- Modify: `src/features/create/steps/generate-step.tsx`

- [ ] **Step 1: Replace max-h scroll container with flow layout**

Find:
```tsx
<div className="max-h-[60vh] overflow-y-auto pr-1">
```

Replace with:
```tsx
<div className="space-y-3">
```

- [ ] **Step 2: Commit**

```bash
git add src/features/create/steps/generate-step.tsx
git commit -m "fix(A9): remove nested scroll from generated review cards

Cards now flow on the page — browser page scrolls instead of a
nested 60vh panel."
```

---

## Task 17: Full-Width Shell with Readable Generate Columns (A10)

**Files:**
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/features/create/steps/generate-step.tsx`

- [ ] **Step 1: Remove global max-w and add responsive padding**

In `src/components/layout/app-shell.tsx`, replace the `<main>` element:

```tsx
      <main className="w-full px-4 pt-6 pb-[44px] sm:px-6 sm:pb-0 lg:px-8 xl:px-12 2xl:px-16">
        {children}
      </main>
```

- [ ] **Step 2: Add local width constraint to generated copy grid**

In `src/features/create/steps/generate-step.tsx`, wrap the platform copy grid:

```tsx
  <div className="mx-auto w-full max-w-6xl">
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {/* platform copy cards */}
    </div>
  </div>
```

- [ ] **Step 3: Visually verify on wide and mobile viewports**

Start dev server. Check:
- Wide screen: shell uses full width, generate columns remain readable at max-w-6xl.
- Mobile: responsive padding looks correct, no horizontal overflow.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/app-shell.tsx src/features/create/steps/generate-step.tsx
git commit -m "feat(A10): full-width shell with readable generate columns

Remove global 1440px max-width. Add progressive horizontal padding.
Generated platform-copy grid capped at max-w-6xl for readability."
```

---

# Wave 3: CI, Security Backlog, and Cleanup

## Task 18: Fix Date-Sensitive Unit Test (B8)

**Files:**
- Modify: `tests/lib/create/service.test.ts`

- [ ] **Step 1: Add vi.useFakeTimers to freeze time before the fixture dates**

In `tests/lib/create/service.test.ts`, find the `createPromotionCampaign - phase date regression` test. Add time freezing:

```typescript
describe('createPromotionCampaign - phase date regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves raw end date in promptContext.promotionEnd', () => {
    // ... existing test body unchanged — fixtures use May 15-20 which are now in the future
  });
});
```

- [ ] **Step 2: Run the specific test**

Run: `npx vitest run tests/lib/create/service.test.ts -t "phase date regression" -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/lib/create/service.test.ts
git commit -m "fix(B8): freeze time in date-sensitive promotion test

Test fixtures use May 15-20 2026 dates. After May 20, no plans are
generated because dates are past. vi.useFakeTimers to May 14 ensures
fixtures always work regardless of when tests run."
```

---

## Task 19: Update E2E Auth Routes (B9)

**Files:**
- Modify: `e2e/fixtures/page-objects/login.page.ts`
- Modify: `e2e/tests/smoke/sign-in.spec.ts`

- [ ] **Step 1: Update login page object**

In `e2e/fixtures/page-objects/login.page.ts`, change the navigation URL:

```typescript
// Replace:
await this.page.goto('/auth/sign-in');
// With:
await this.page.goto('/login');
```

- [ ] **Step 2: Update redirect assertion**

In `e2e/tests/smoke/sign-in.spec.ts`, update the unauthenticated redirect assertion:

```typescript
// Replace:
expect(page.url()).toContain('/sign-in');
// With:
expect(page.url()).toContain('/login');
```

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures/page-objects/login.page.ts e2e/tests/smoke/sign-in.spec.ts
git commit -m "fix(B9): update E2E auth routes from /auth/sign-in to /login

Page object and smoke test referenced /auth/sign-in but the app
exposes /login. Updated to match actual routing."
```

---

## Task 20: Fix CI Build Env (B10)

**Files:**
- Modify: GitHub Actions / CI env config if present
- Modify: `src/env.ts` only if an explicit build-only bypass is needed

- [ ] **Step 1: Prefer safe CI placeholders over weakening runtime validation**

The spec allows either safe CI placeholders or an explicit build-only bypass. Prefer adding non-production placeholder env vars to the CI job first. Only change `src/env.ts` if CI cannot supply placeholders.

If a code bypass is required, do not skip validation merely because `CI=true`; that can hide misconfigured production builds. Use an explicit `SKIP_ENV_VALIDATION=1` flag that is set only in the build job, and keep runtime validation strict everywhere else:

```typescript
function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.SKIP_ENV_VALIDATION === '1') return;

  // ... existing validation
}
```

Document the flag in `.env.example` only as a CI/build escape hatch, not as a local or production runtime setting.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS without required-env failures.

- [ ] **Step 3: Commit**

```bash
git add src/env.ts .github/workflows

git commit -m "fix(B10): provide explicit CI build env handling

CI builds lacked required production env vars. Prefer safe placeholders;
where a bypass is needed, use explicit SKIP_ENV_VALIDATION=1 rather than
implicitly trusting CI=true."
```

---

## Task 21: Quiet Dynamic Server Usage Build Logs (B11)

**Files:**
- Modify: `src/lib/auth/server.ts`

- [ ] **Step 1: Catch Next.js dynamic rendering errors specifically**

In `src/lib/auth/server.ts`, find the `getCurrentUser()` catch block. Check for Next's dynamic error:

```typescript
  } catch (error) {
    // Next.js throws a "Dynamic server usage" error during static generation
    // for pages that call cookies()/headers(). This is a control-flow signal,
    // not an auth failure.
    if (error instanceof Error && error.message.includes('Dynamic server usage')) {
      throw error; // Re-throw so Next.js handles it correctly
    }
    console.error('[auth] getCurrentUser unexpected error:', error);
    return null;
  }
```

- [ ] **Step 2: Build and check log output**

Run: `npm run build 2>&1 | rg -c "Dynamic server usage" || true`
Expected: Count should be 0 or significantly reduced.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/server.ts
git commit -m "fix(B11): re-throw Next.js dynamic rendering errors in getCurrentUser

getCurrentUser was catching and logging Next's 'Dynamic server usage'
control-flow error as an auth failure. Now re-throws it so Next.js
handles static/dynamic rendering correctly."
```

---

## Task 22: Finish Token Vault Read Migration (B4)

**Files:**
- Modify: `src/lib/publishing/preflight.ts`
- Modify: `src/app/(app)/reviews/actions.ts`
- Modify: `src/app/api/cron/sync-gbp-reviews/route.ts`
- Modify or retire: `supabase/functions/publish-queue/worker.ts`
- Review: `src/app/(app)/connections/actions-ads.ts`, campaign Meta actions, and diagnostics paths that still read plaintext tokens

Treat this as a pre-production security gate if plaintext token columns are already null in production or if new OAuth connections are expected to publish without legacy backfill.

- [ ] **Step 1: Inventory plaintext token reads**

Run:

```bash
rg -n "access_token|refresh_token" src supabase/functions -g "*.ts" -g "*.tsx"
```

Classify each result as one of:

- OAuth exchange response variable, safe.
- Provider API request parameter, safe if value came from vault.
- DB read/write of plaintext token column, must migrate or explicitly mark legacy.

- [ ] **Step 2: Migrate active social connection reads to token vault helpers**

Use `src/lib/providers/token-helpers.ts` as the shared contract. Active publish, preflight, GBP reviews, and token refresh paths should read `access_token` / `refresh_token` from `token_vault`, not `social_connections`.

- [ ] **Step 3: Decide legacy Supabase worker fate**

If `supabase/functions/publish-queue/worker.ts` is retired by Task 9, document that and keep it locked down. If it is still active anywhere, it must be migrated to token vault or removed from deployment before B4 can be marked complete.

- [ ] **Step 4: Update tests**

Add or update tests that prove:

- New OAuth writes tokens to `token_vault` only.
- Preflight succeeds when tokens exist in `token_vault` and plaintext columns are null.
- GBP review sync refreshes and writes updated access tokens back to `token_vault`.

---

## Task 23: Resolve Dependency Audit Backlog (B7)

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Re-run audit and outdated checks**

```bash
npm audit --audit-level=moderate
npm outdated --long
```

- [ ] **Step 2: Patch within the current major line where possible**

Prioritise high-severity advisories, especially framework/runtime packages. Do not blindly run `npm audit fix --force`; that may jump major versions and should be handled as a deliberate upgrade with build and browser verification.

- [ ] **Step 3: Verify**

Run `npm run lint:ci`, `npm run typecheck`, `CI=1 npm test -- --run`, and `npm run build` after dependency changes.

---

## Task 24: Fix Proxy, Public SEO, and Production CSP (B12-B14)

**Files:**
- Review/move: `src/app/proxy.ts`
- Modify: `middleware.ts` or root `proxy.ts`
- Modify: `src/app/robots.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/lib/security/headers.ts`

- [ ] **Step 1: Put proxy/middleware code where Next actually loads it**

`src/app/proxy.ts` is not a route and is unlikely to be executed from that location. Move the logic to the framework-recognised root proxy/middleware location or merge it into the existing root `middleware.ts`, then add a route-level test if feasible.

- [ ] **Step 2: Remove global public noindex where inappropriate**

The app currently disables public SEO globally through robots metadata/headers. Keep noindex for authenticated app surfaces, but allow intended public pages such as public link-in-bio, privacy, terms, help, and any marketing/public routes.

- [ ] **Step 3: Split development and production CSP**

`src/lib/security/headers.ts` currently allows broad `unsafe-inline` / `unsafe-eval`. Keep development allowances where required, but tighten production CSP and document any remaining exception with the specific framework/library reason.

---

## Task 25: Make Link-in-Bio View Tracking ISR-Safe (B15)

**Files:**
- Modify: `src/app/(public)/l/[slug]/page.tsx`
- Modify or create: link-in-bio tracking route/action under `src/app/api/`
- Modify: `src/lib/link-in-bio/public.ts`

The public link-in-bio page uses ISR (`revalidate = 300`). Any view tracking done during the server render is skipped on cached hits.

- [ ] Move view tracking to a client `sendBeacon` / fetch endpoint, middleware, or another request path that runs for every page view.
- [ ] Keep the public page cacheable.
- [ ] Add throttling/deduplication so reloads do not create noisy analytics.

---

## Task 26: Reconcile Schema and Environment Documentation (B16-B17)

**Files:**
- Modify: `.env.example`
- Modify docs/schema files only if they are part of this worktree's documentation pass
- Add migration only if schema cleanup is safe and backwards-compatible

- [ ] **Step 1: Reconcile `.env.example` with `src/env.ts`**

Ensure `.env.example` includes active variables for token vault, Axiom, Upstash Redis, QStash, Supabase, OpenAI, Resend, cron, and public site config. Remove or mark unused variables so deploy setup does not drift.

- [ ] **Step 2: Document schema cleanup candidates**

The v1/v2 bridge leaves compatibility surfaces such as `media_library.file_url` storing storage paths and parallel media tables. Do not drop columns/tables in this plan unless the migration is proven safe. Capture cleanup as a follow-up migration with rollback notes.

---

## Task 27: Clean Worktree Artifacts Before Handoff (B18)

**Files:**
- Review untracked generated artifacts and backup files before any commit/PR

- [ ] Remove generated local artifacts such as `node-compile-cache/` if they are not intentionally tracked.
- [ ] Confirm whether large backup files such as `supabase/remote-v1-backup.sql` should be ignored, archived outside the repo, or committed deliberately.
- [ ] Keep unrelated dirty documentation changes out of implementation commits unless the user explicitly wants them included.

---

## Final Verification

After all tasks are complete:

- [ ] **Run full CI pipeline**

```bash
npm run ci:verify
```

Expected: lint, typecheck, test, build all pass.

- [ ] **Run manual QA flows from the spec's testing plan**

Refer to the spec's "Manual QA" table in the Testing Plan section for the full checklist.

---

## Open Questions (from spec — decisions needed before deployment)

1. Is production intended to use only the Next.js/QStash publishing path? If the Supabase `publish-queue` worker is still active, B1 must be coordinated with ops.
2. Should wizard-created instant posts inherit account banner defaults? Task 14 assumes yes.
3. Should GBP promotions require a coupon code? Current implementation makes it optional per the brief schema.
4. Should manual weekly recurring slots receive a semantic label? Task 10 only covers event and promotion.
5. Should batch creation move into a DB transaction/RPC after this release? This plan requires rollback if sequential writes are kept, but a transaction/RPC would still be cleaner long-term.
