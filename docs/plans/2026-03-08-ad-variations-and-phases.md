# Ad Variations and Time-Phased Ad Sets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current "2-3 ad sets × 2 ads" AI structure with time-phased ad sets (AI decides phase count from campaign dates) and exactly 5 copy variations per phase as individual ads.

**Architecture:** The AI prompt is updated to generate time phases instead of audience segments; each phase becomes an ad set with `phase_start`/`phase_end` date windows and 5 variation ads with varying CTAs. The DB gains two nullable date columns on `ad_sets`. Publishing passes per-adset phase dates to Meta's `start_time`/`end_time`. The UI renames ad tree nodes to "Variation N" and shows phase metadata on the ad set editor panel.

**Tech Stack:** TypeScript strict, Next.js 15 App Router, Supabase PostgreSQL, OpenAI `gpt-4o` with `json_object` response format, Meta Marketing API.

---

### Task 1: Database migration — add phase dates to `ad_sets`

**Files:**
- Create: `supabase/migrations/20260308160000_add_phase_dates_to_ad_sets.sql`

**Step 1: Write the migration**

```sql
-- Add phase date columns to ad_sets (nullable — non-event campaigns may not use phases)
ALTER TABLE ad_sets
  ADD COLUMN IF NOT EXISTS phase_start date,
  ADD COLUMN IF NOT EXISTS phase_end   date;
```

**Step 2: Apply migration**

Run: `npx supabase db push`
Expected: `Applied 1 migration` (or `0 migrations to apply` if already applied, which would be an error — verify the file was created correctly).

**Step 3: Commit**

```bash
git add supabase/migrations/20260308160000_add_phase_dates_to_ad_sets.sql
git commit -m "feat: add phase_start and phase_end columns to ad_sets"
```

---

### Task 2: Update TypeScript types

**Files:**
- Modify: `src/types/campaigns.ts`

**Step 1: Add phase fields to `AiCampaignPayload` ad set shape**

In the `AiCampaignPayload` interface, add three fields inside `ad_sets`:

```typescript
ad_sets: Array<{
  name: string;
  phase_label: string;      // e.g. "Early Awareness"
  phase_start: string;      // ISO date e.g. "2026-03-01"
  phase_end: string | null; // ISO date or null for last phase
  audience_description: string;
  targeting: AdTargeting;
  placements: 'AUTO';
  optimisation_goal: string;
  bid_strategy: string;
  ads: Array<{
    name: string;
    headline: string;
    primary_text: string;
    description: string;
    cta: CtaType;
    creative_brief: string;
    image_url?: string;
    media_asset_id?: string;
  }>;
}>;
```

**Step 2: Add phase fields to the `AdSet` interface**

```typescript
export interface AdSet {
  id: string;
  campaignId: string;
  metaAdsetId: string | null;
  name: string;
  phaseLabel: string | null;   // <-- add
  phaseStart: string | null;   // <-- add
  phaseEnd: string | null;     // <-- add
  targeting: AdTargeting;
  placements: 'AUTO' | object;
  budgetAmount: number | null;
  optimisationGoal: string;
  bidStrategy: string;
  status: AdSetStatus;
  createdAt: Date;
  ads?: Ad[];
}
```

**Step 3: Run typecheck to confirm no breakage**

Run: `npx tsc --noEmit`
Expected: clean (or only pre-existing errors — note any new ones and fix them)

**Step 4: Commit**

```bash
git add src/types/campaigns.ts
git commit -m "feat: add phase_label, phase_start, phase_end to AiCampaignPayload and AdSet types"
```

---

### Task 3: Update AI generation — prompt + schema + defensive enforcement

**Files:**
- Modify: `src/lib/campaigns/generate.ts`
- Create: `src/lib/campaigns/generate.test.ts`

**Step 1: Write the failing tests first**

```typescript
// src/lib/campaigns/generate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiCampaignPayload } from '@/types/campaigns';

// We test the module-level enforcement logic by importing a helper we'll extract.
// The helper pads/trims ads per adset and enforces character limits.
import { enforceAdSetConstraints } from './generate';

const makeAd = (overrides?: object) => ({
  name: 'Ad',
  headline: 'Hello',
  primary_text: 'Buy now',
  description: 'Great deal',
  cta: 'LEARN_MORE' as const,
  creative_brief: 'Show happy people',
  ...overrides,
});

const makeAdSet = (ads: ReturnType<typeof makeAd>[]) => ({
  name: 'Phase 1',
  phase_label: 'Early Awareness',
  phase_start: '2026-03-01',
  phase_end: '2026-03-07',
  audience_description: 'Local adults',
  targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ['GB'] } },
  placements: 'AUTO' as const,
  optimisation_goal: 'REACH',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  ads,
});

describe('enforceAdSetConstraints', () => {
  it('trims ad sets with more than 5 ads to exactly 5', () => {
    const adSet = makeAdSet(Array.from({ length: 7 }, (_, i) => makeAd({ name: `Ad ${i}` })));
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(5);
  });

  it('pads ad sets with fewer than 5 ads by duplicating the last entry', () => {
    const adSet = makeAdSet([makeAd({ name: 'Only One' })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(5);
    expect(result.ads[4]).toEqual(result.ads[0]);
  });

  it('leaves ad sets with exactly 5 ads unchanged', () => {
    const adSet = makeAdSet(Array.from({ length: 5 }, (_, i) => makeAd({ name: `Ad ${i}` })));
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(5);
  });

  it('truncates headline to 40 characters', () => {
    const longHeadline = 'A'.repeat(50);
    const adSet = makeAdSet([makeAd({ headline: longHeadline })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].headline).toHaveLength(40);
  });

  it('truncates primary_text to 125 characters', () => {
    const long = 'B'.repeat(130);
    const adSet = makeAdSet([makeAd({ primary_text: long })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].primary_text).toHaveLength(125);
  });

  it('truncates description to 25 characters', () => {
    const long = 'C'.repeat(30);
    const adSet = makeAdSet([makeAd({ description: long })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].description).toHaveLength(25);
  });
});
```

**Step 2: Run to confirm tests fail**

Run: `npx vitest run src/lib/campaigns/generate.test.ts`
Expected: FAIL — `enforceAdSetConstraints` is not exported

**Step 3: Update `generate.ts`**

Replace the entire file content:

```typescript
import OpenAI from 'openai';

import { env } from '@/env';
import type { AiCampaignPayload, BudgetType } from '@/types/campaigns';

interface GenerateInput {
  problemBrief: string;
  venueName: string;
  venueLocation: string;
  budgetAmount: number;
  budgetType: BudgetType;
  startDate: string;
  endDate: string | null;
}

const VALID_CTAS = ['LEARN_MORE', 'SIGN_UP', 'BOOK_NOW', 'GET_QUOTE', 'CONTACT_US', 'SUBSCRIBE'] as const;

const SYSTEM_PROMPT = `You are an expert Meta (Facebook/Instagram) advertising strategist.
Given a campaign brief and date range, generate a time-phased campaign structure.

RULES:
- headline: max 40 characters
- primary_text: max 125 characters
- description: max 25 characters
- Decide how many phases make sense given the campaign dates (typically 2–4; use more phases when the date range allows)
- Each phase is an ad set with a date window, a phase label (e.g. "Early Awareness", "Urgency Push"), and EXACTLY 5 ads
- Each of the 5 ads is a copy variation — same audience, different messaging angle
- CTA can vary across the 5 variations (treat it as a learning dimension)
- Valid CTA values: LEARN_MORE, SIGN_UP, BOOK_NOW, GET_QUOTE, CONTACT_US, SUBSCRIBE
- Use real Meta API objective values: OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES
- Use real Meta optimisation goals: REACH, LINK_CLICKS, LEAD_GENERATION, OFFSITE_CONVERSIONS, POST_ENGAGEMENT
- Targeting geo_locations should use UK cities or country code 'GB'
- Return ONLY valid JSON matching the specified schema, no markdown

SPECIAL AD CATEGORIES: If the brief relates to housing, employment, credit, or political issues, set special_ad_category to the relevant value. Otherwise use "NONE".`;

export function enforceAdSetConstraints(
  adSet: AiCampaignPayload['ad_sets'][number],
): AiCampaignPayload['ad_sets'][number] {
  let ads = [...adSet.ads];

  // Trim to 5
  if (ads.length > 5) ads = ads.slice(0, 5);

  // Pad to 5 by duplicating last entry
  while (ads.length < 5) {
    ads.push({ ...ads[ads.length - 1] });
  }

  // Enforce character limits
  ads = ads.map((ad) => ({
    ...ad,
    headline: ad.headline.length > 40 ? ad.headline.slice(0, 40) : ad.headline,
    primary_text: ad.primary_text.length > 125 ? ad.primary_text.slice(0, 125) : ad.primary_text,
    description: ad.description.length > 25 ? ad.description.slice(0, 25) : ad.description,
  }));

  return { ...adSet, ads };
}

export async function generateCampaign(input: GenerateInput): Promise<AiCampaignPayload> {
  const client = new OpenAI({ apiKey: env.server.OPENAI_API_KEY });

  const userPrompt = `
Business problem: ${input.problemBrief}
Venue: ${input.venueName}, ${input.venueLocation}
Budget: £${input.budgetAmount} (${input.budgetType})
Campaign dates: ${input.startDate} to ${input.endDate ?? 'ongoing'}

Generate a time-phased Meta campaign. Return JSON matching this schema:
{
  "objective": "OUTCOME_LEADS",
  "rationale": "string explaining the strategy and phase structure",
  "campaign_name": "string",
  "special_ad_category": "NONE",
  "ad_sets": [
    {
      "name": "string (e.g. 'Early Awareness - 1 Mar')",
      "phase_label": "string (e.g. 'Early Awareness')",
      "phase_start": "YYYY-MM-DD",
      "phase_end": "YYYY-MM-DD or null for last phase",
      "audience_description": "string",
      "targeting": {
        "age_min": number,
        "age_max": number,
        "genders": [1, 2],
        "geo_locations": { "countries": ["GB"] },
        "interests": [{ "id": "string", "name": "string" }]
      },
      "placements": "AUTO",
      "optimisation_goal": "string",
      "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
      "ads": [
        {
          "name": "Variation 1",
          "headline": "string (max 40 chars)",
          "primary_text": "string (max 125 chars)",
          "description": "string (max 25 chars)",
          "cta": "LEARN_MORE",
          "creative_brief": "string describing ideal image/video"
        }
      ]
    }
  ]
}
The ads array must contain EXACTLY 5 entries per ad set, each with a different messaging angle.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content returned from AI');

  const payload = JSON.parse(content) as AiCampaignPayload;

  // Defensive enforcement: pad/trim to 5 ads per adset; enforce character limits
  payload.ad_sets = payload.ad_sets.map(enforceAdSetConstraints);

  return payload;
}
```

**Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/lib/campaigns/generate.test.ts`
Expected: 6/6 PASS

**Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean

**Step 6: Commit**

```bash
git add src/lib/campaigns/generate.ts src/lib/campaigns/generate.test.ts
git commit -m "feat: update AI prompt to generate time-phased ad sets with 5 variations each"
```

---

### Task 4: Update `saveCampaignDraft` — persist phase dates

**Files:**
- Modify: `src/app/(app)/campaigns/actions.ts`

No new tests needed — the change is a one-line add to the existing insert.

**Step 1: Add `phase_start` and `phase_end` to the ad set insert**

In `saveCampaignDraft`, locate the `ad_sets` insert block. Add the two new fields:

Old block (line ~140–150):
```typescript
const { data: adSetRow, error: adSetError } = await supabase
  .from('ad_sets')
  .insert({
    campaign_id: campaignId,
    name: adSetInput.name,
    targeting: adSetInput.targeting,
    placements: adSetInput.placements,
    optimisation_goal: adSetInput.optimisation_goal,
    bid_strategy: adSetInput.bid_strategy,
    status: 'DRAFT',
  })
```

New block:
```typescript
const { data: adSetRow, error: adSetError } = await supabase
  .from('ad_sets')
  .insert({
    campaign_id: campaignId,
    name: adSetInput.name,
    phase_start: adSetInput.phase_start ?? null,
    phase_end: adSetInput.phase_end ?? null,
    targeting: adSetInput.targeting,
    placements: adSetInput.placements,
    optimisation_goal: adSetInput.optimisation_goal,
    bid_strategy: adSetInput.bid_strategy,
    status: 'DRAFT',
  })
```

**Step 2: Update the `AdSetDbRow` interface and `dbRowToAdSet` mapper** (they are in the same file)

Add to `AdSetDbRow`:
```typescript
phase_start: string | null;
phase_end: string | null;
```

Update `dbRowToAdSet` to map the new fields onto `AdSet`:
```typescript
function dbRowToAdSet(row: AdSetDbRow): AdSet {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    metaAdsetId: row.meta_adset_id,
    name: row.name,
    phaseLabel: null,   // not stored in DB — only in AI payload
    phaseStart: row.phase_start,
    phaseEnd: row.phase_end,
    targeting: row.targeting as AdSet['targeting'],
    placements: row.placements as AdSet['placements'],
    budgetAmount: row.budget_amount,
    optimisationGoal: row.optimisation_goal,
    bidStrategy: row.bid_strategy,
    status: row.status as AdSetStatus,
    createdAt: new Date(row.created_at),
    ads: row.ads?.map(dbRowToAd),
  };
}
```

Note: `phase_label` is an AI generation concept used in the payload but is not stored separately in the DB (the `name` field already captures it). Map it as `null` from the DB.

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean

**Step 4: Commit**

```bash
git add src/app/(app)/campaigns/actions.ts
git commit -m "feat: persist phase_start and phase_end when saving campaign draft"
```

---

### Task 5: Update `publishCampaign` — use per-adset phase dates for Meta

**Files:**
- Modify: `src/app/(app)/campaigns/[id]/actions.ts`

**Step 1: Add `phase_start` and `phase_end` to the `AdSetRow` local interface**

At the top of the file, the `AdSetRow` interface is:
```typescript
interface AdSetRow {
  id: string;
  name: string;
  targeting: Record<string, unknown>;
  optimisation_goal: string;
  bid_strategy: string;
  budget_amount: number | null;
  ads: AdRow[];
}
```

Add the two new fields:
```typescript
interface AdSetRow {
  id: string;
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

**Step 2: Add `phase_start, phase_end` to the ad sets select query**

Find the Supabase query that fetches ad sets (line ~145):
```typescript
.select('id, name, targeting, optimisation_goal, bid_strategy, budget_amount, ads(*)')
```

Change to:
```typescript
.select('id, name, targeting, optimisation_goal, bid_strategy, budget_amount, phase_start, phase_end, ads(*)')
```

**Step 3: Use phase dates in `createMetaAdSet` call**

Find the `createMetaAdSet` call (line ~192):
```typescript
metaAdSet = await createMetaAdSet({
  accessToken,
  adAccountId,
  campaignId: metaCampaign.id,
  name: adSet.name,
  targeting: adSet.targeting,
  optimisationGoal: adSet.optimisation_goal,
  bidStrategy: adSet.bid_strategy,
  dailyBudget: isDaily ? budgetAmount : undefined,
  lifetimeBudget: !isDaily ? budgetAmount : undefined,
  startTime: campaign.start_date,
  endTime: campaign.end_date ?? undefined,
  status: 'PAUSED',
});
```

Change the `startTime` and `endTime` lines:
```typescript
metaAdSet = await createMetaAdSet({
  accessToken,
  adAccountId,
  campaignId: metaCampaign.id,
  name: adSet.name,
  targeting: adSet.targeting,
  optimisationGoal: adSet.optimisation_goal,
  bidStrategy: adSet.bid_strategy,
  dailyBudget: isDaily ? budgetAmount : undefined,
  lifetimeBudget: !isDaily ? budgetAmount : undefined,
  startTime: adSet.phase_start ?? campaign.start_date,
  endTime: (adSet.phase_end ?? campaign.end_date) ?? undefined,
  status: 'PAUSED',
});
```

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean

**Step 5: Commit**

```bash
git add src/app/(app)/campaigns/[id]/actions.ts
git commit -m "feat: use per-adset phase dates when publishing to Meta"
```

---

### Task 6: Update `CampaignTree.tsx` — phase metadata and variation labels

**Files:**
- Modify: `src/features/campaigns/CampaignTree.tsx`

**Step 1: Update the ad tree node labels to "Variation N"**

In the left tree, the ad nodes currently show `{ad.name}`. Change them to show "Variation {di + 1}":

Find (line ~312):
```tsx
<span className="truncate block">{ad.name}</span>
```

Change to:
```tsx
<span className="truncate block">Variation {di + 1}</span>
```

**Step 2: Show phase label and date range on ad set tree nodes**

The design calls for ad set nodes to show "Early Awareness · 1–14 Mar". The `phase_label` lives on `AiCampaignPayload` ad sets but not on the saved `AdSet` DB type. Since `CampaignTree` only receives `AiCampaignPayload` (not `AdSet[]`), `adset.phase_label` is available directly.

Find the ad set tree button text (line ~295):
```tsx
<span className="truncate">{adset.name}</span>
```

Change to:
```tsx
<span className="truncate">
  {adset.phase_label ?? adset.name}
  {adset.phase_start && (
    <span className="font-normal opacity-70 ml-1">
      · {formatPhaseRange(adset.phase_start, adset.phase_end)}
    </span>
  )}
</span>
```

**Step 3: Add the `formatPhaseRange` helper** inside the component file, above the component function:

```typescript
function formatPhaseRange(start: string, end: string | null): string {
  const startDate = new Date(start);
  const startDay = startDate.getDate();
  const startMonth = startDate.toLocaleString('en-GB', { month: 'short' });
  if (!end) return `${startDay} ${startMonth}+`;
  const endDate = new Date(end);
  const endDay = endDate.getDate();
  const endMonth = endDate.toLocaleString('en-GB', { month: 'short' });
  if (startMonth === endMonth) return `${startDay}–${endDay} ${startMonth}`;
  return `${startDay} ${startMonth}–${endDay} ${endMonth}`;
}
```

**Step 4: Show phase dates in the ad set editor panel**

In `renderCentrePanel`, inside the `selected.type === 'adset'` branch, add phase metadata after the existing fields. After the bid strategy display block, add:

```tsx
{adset.phase_start && (
  <div>
    <p className="text-xs font-semibold text-muted-foreground mb-1">Phase window</p>
    <p className="text-sm text-foreground">
      {adset.phase_start}
      {adset.phase_end ? ` → ${adset.phase_end}` : ' (open-ended)'}
    </p>
  </div>
)}
{adset.phase_label && (
  <div>
    <p className="text-xs font-semibold text-muted-foreground mb-1">Phase theme</p>
    <p className="text-sm text-foreground">{adset.phase_label}</p>
  </div>
)}
```

**Step 5: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean

**Step 6: Run full CI verify**

Run: `npm run ci:verify`
Expected: lint ✓ typecheck ✓ tests ✓ build ✓

**Step 7: Commit**

```bash
git add src/features/campaigns/CampaignTree.tsx
git commit -m "feat: show phase labels, date ranges, and variation numbering in CampaignTree"
```
