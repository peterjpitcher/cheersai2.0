# Campaigns Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Meta Ads campaign generation with 3 conversion-optimised variations per ad set, fixed 3-phase date structure, and ad set-level image assignment.

**Architecture:** Phase calculation is extracted into a pure utility (`phases.ts`), the AI prompt is rewritten to extract USPs and assign distinct angles, and the CampaignTree UI gains ad set-level image management and angle labelling. All changes flow through the existing `AiCampaignPayload` state shape with minimal new fields.

**Tech Stack:** Next.js 15, TypeScript, Supabase (PostgreSQL), OpenAI gpt-4o, Vitest, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-14-campaigns-improvements-design.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260314_campaigns_improvements.sql` | Add `angle` to `ads`, add 3 cols to `ad_sets` |
| Modify | `src/types/campaigns.ts` | Add `angle`, `adsetMediaAssetId`, `adsetImageUrl`, `adsStopTime` to types |
| Create | `src/lib/campaigns/phases.ts` | Pure phase calculation utility |
| Create | `tests/campaigns/phases.test.ts` | Tests for phase calculation |
| Modify | `src/lib/campaigns/generate.ts` | Rewrite prompt, 3 variations, angle field, accept phases |
| Create | `tests/campaigns/generate.test.ts` | Tests for enforceAdSetConstraints (3 variations) |
| Modify | `src/app/(app)/campaigns/actions.ts` | Calculate phases before AI call, persist new fields |
| Modify | `src/features/campaigns/CampaignBriefForm.tsx` | Add `adsStopTime` field, pass to actions |
| Modify | `src/features/campaigns/CampaignTree.tsx` | Angle labels, char count, adset image picker, apply-to-all, creative brief |

---

## Chunk 1: Foundation — Migration, Types, and Phase Utility

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260314_campaigns_improvements.sql`

- [ ] **Step 1.1: Create migration file**

```sql
-- supabase/migrations/20260314_campaigns_improvements.sql

-- Add angle label to ads (free-text, AI-assigned, e.g. "Jackpot & prize mechanic")
ALTER TABLE ads ADD COLUMN angle TEXT;

-- Add adset-level shared image fields (denormalised cache — always written together)
ALTER TABLE ad_sets ADD COLUMN adset_media_asset_id UUID REFERENCES media_assets(id);
ALTER TABLE ad_sets ADD COLUMN adset_image_url TEXT;

-- Add stop time for Day Of ad set (NULL = no stop time; existing rows treated as NULL)
ALTER TABLE ad_sets ADD COLUMN ads_stop_time TIME;
```

- [ ] **Step 1.2: Apply migration locally**

```bash
cd /Users/peterpitcher/Cursor/OJ-CheersAI2.0
npx supabase db push --dry-run
```
Expected: migration listed, no errors.

```bash
npx supabase db push
```
Expected: migration applied successfully.

- [ ] **Step 1.3: Commit**

```bash
git add supabase/migrations/20260314_campaigns_improvements.sql
git commit -m "feat: add angle, adset image, and stop time columns to campaigns tables"
```

---

### Task 2: Update TypeScript types

**Files:**
- Modify: `src/types/campaigns.ts`

- [ ] **Step 2.1: Add `angle` to `Ad` interface**

In `src/types/campaigns.ts`, find the `Ad` interface. Add a **single line** after the `cta` field — do not replace the whole block:

```typescript
  cta: CtaType;
  angle: string | null;           // ← add this line only
  mediaAssetId: string | null;
```

> **Note:** `angle` is `string | null` here (the DB persisted type). In `AiCampaignPayload` (Step 2.3) it is typed `string` (non-nullable) because the AI always assigns it. These two types are intentionally different — do not conflate them.

- [ ] **Step 2.2: Add image and stop-time fields to `AdSet` interface**

Find the `AdSet` interface and add after `bidStrategy`:

```typescript
export interface AdSet {
  id: string;
  campaignId: string;
  metaAdsetId: string | null;
  name: string;
  phaseLabel: string | null;
  phaseStart: string | null;
  phaseEnd: string | null;
  targeting: AdTargeting;
  placements: 'AUTO' | object;
  budgetAmount: number | null;
  optimisationGoal: string;
  bidStrategy: string;
  adsetMediaAssetId: string | null;   // ← add
  adsetImageUrl: string | null;        // ← add
  adsStopTime: string | null;          // ← add (HH:MM format)
  status: AdSetStatus;
  createdAt: Date;
  ads?: Ad[];
}
```

- [ ] **Step 2.3: Update `AiCampaignPayload` — add `angle` to ads**

Find the `AiCampaignPayload` interface. In the `ads` array object, add `angle` after `creative_brief`:

```typescript
ads: Array<{
  name: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: CtaType;
  angle: string;            // ← add (AI assigns this)
  creative_brief: string;
  image_url?: string;
  media_asset_id?: string;
}>;
```

- [ ] **Step 2.4: Update `AiCampaignPayload` — add image and stop-time fields to ad sets**

In the `ad_sets` array object inside `AiCampaignPayload`, add after `bid_strategy`:

```typescript
adset_media_asset_id?: string;   // ← add (user-set, not AI)
adset_image_url?: string;         // ← add (user-set, not AI)
ads_stop_time?: string;           // ← add (user-set, not AI)
```

- [ ] **Step 2.5: Type-check**

```bash
npm run typecheck
```
Expected: zero errors. Fix any type errors before continuing.

- [ ] **Step 2.6: Commit**

```bash
git add src/types/campaigns.ts
git commit -m "feat: add angle, adset image and stop-time fields to campaign types"
```

---

### Task 3: Phase calculation utility and tests

**Files:**
- Create: `src/lib/campaigns/phases.ts`
- Create: `tests/campaigns/phases.test.ts`

- [ ] **Step 3.1: Write the failing tests first**

Create `tests/campaigns/phases.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calculatePhases } from '@/lib/campaigns/phases';

describe('calculatePhases', () => {
  // Helper to get phase labels
  const labels = (phases: ReturnType<typeof calculatePhases>) =>
    phases.map((p) => p.phaseLabel);

  it('same-day campaign (0 days apart): returns only Day Of', () => {
    const phases = calculatePhases('2026-03-18', '2026-03-18', '19:00');
    expect(labels(phases)).toEqual(['Day Of']);
    expect(phases[0].adsStopTime).toBe('19:00');
  });

  it('1-day campaign (start = event - 1): returns Day Before + Day Of', () => {
    const phases = calculatePhases('2026-03-17', '2026-03-18', '19:00');
    expect(labels(phases)).toEqual(['Day Before', 'Day Of']);
    expect(phases[0].phaseStart).toBe('2026-03-17');
    expect(phases[1].phaseStart).toBe('2026-03-18');
  });

  it('2-day campaign (start = event - 2): returns Day Before + Day Of (no Run-up)', () => {
    const phases = calculatePhases('2026-03-16', '2026-03-18', '19:00');
    expect(labels(phases)).toEqual(['Day Before', 'Day Of']);
  });

  it('3-day campaign (start = event - 3): returns all 3 phases', () => {
    const phases = calculatePhases('2026-03-15', '2026-03-18', '19:00');
    expect(labels(phases)).toEqual(['Run-up', 'Day Before', 'Day Of']);
    expect(phases[0].phaseStart).toBe('2026-03-15');
    expect(phases[0].phaseEnd).toBe('2026-03-16'); // event - 2
    expect(phases[1].phaseStart).toBe('2026-03-17'); // event - 1
    expect(phases[2].phaseStart).toBe('2026-03-18');
    expect(phases[2].adsStopTime).toBe('19:00');
  });

  it('7-day campaign: returns all 3 phases with correct Run-up window', () => {
    const phases = calculatePhases('2026-03-11', '2026-03-18', '20:00');
    expect(labels(phases)).toEqual(['Run-up', 'Day Before', 'Day Of']);
    expect(phases[0].phaseStart).toBe('2026-03-11');
    expect(phases[0].phaseEnd).toBe('2026-03-16'); // event - 2
    expect(phases[1].phaseStart).toBe('2026-03-17');
    expect(phases[2].adsStopTime).toBe('20:00');
  });

  it('phase types are correctly assigned', () => {
    const phases = calculatePhases('2026-03-15', '2026-03-18', '19:00');
    expect(phases[0].phaseType).toBe('run-up');
    expect(phases[1].phaseType).toBe('day-before');
    expect(phases[2].phaseType).toBe('day-of');
  });

  it('Day Before and Run-up have no adsStopTime', () => {
    const phases = calculatePhases('2026-03-15', '2026-03-18', '19:00');
    expect(phases[0].adsStopTime).toBeUndefined();
    expect(phases[1].adsStopTime).toBeUndefined();
  });

  it('throws if startDate is after eventDate', () => {
    expect(() => calculatePhases('2026-03-20', '2026-03-18', '19:00')).toThrow();
  });
});
```

> **Note on `phaseEnd` for Day Before:** `phaseEnd` is `null` for the Day Before phase — it is a single-day phase and `phase_end` being null means "ends at end of day". This is consistent with how `phase_end` is stored for the final phase in all ad sets.

- [ ] **Step 3.2: Run tests — verify they fail**

```bash
npx vitest run tests/campaigns/phases.test.ts
```
Expected: FAIL — `@/lib/campaigns/phases` not found.

- [ ] **Step 3.3: Create the phases utility**

Create `src/lib/campaigns/phases.ts`:

```typescript
export interface CampaignPhase {
  phaseLabel: string;
  phaseStart: string;        // YYYY-MM-DD
  phaseEnd: string | null;   // YYYY-MM-DD or null
  adsStopTime?: string;      // HH:MM — only set on 'day-of' phase
  phaseType: 'run-up' | 'day-before' | 'day-of';
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0] as string;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

function diffDays(startStr: string, endStr: string): number {
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  return Math.round((end - start) / MS_PER_DAY);
}

/**
 * Calculate the fixed 3-phase campaign structure from campaign dates.
 *
 * Phase rules (based on days between startDate and eventDate):
 *   0 days (same-day)  → Day Of only
 *   1–2 days           → Day Before + Day Of
 *   3+ days            → Run-up + Day Before + Day Of
 *
 * The Day Of phase always carries adsStopTime.
 * Run-up end = eventDate − 2 days; Day Before = eventDate − 1 day.
 * Day Before phaseEnd is null (single-day phase, ends at end of day).
 *
 * Throws if startDate is after eventDate.
 */
export function calculatePhases(
  startDate: string,
  eventDate: string,
  adsStopTime: string,
): CampaignPhase[] {
  const daysBetween = diffDays(startDate, eventDate);

  if (daysBetween < 0) {
    throw new Error(
      `startDate (${startDate}) cannot be after eventDate (${eventDate})`,
    );
  }

  const dayOf: CampaignPhase = {
    phaseLabel: 'Day Of',
    phaseStart: eventDate,
    phaseEnd: null,
    adsStopTime,
    phaseType: 'day-of',
  };

  if (daysBetween === 0) {
    return [dayOf];
  }

  const dayBeforeStr = addDays(eventDate, -1);
  const dayBefore: CampaignPhase = {
    phaseLabel: 'Day Before',
    phaseStart: dayBeforeStr,
    phaseEnd: null,
    phaseType: 'day-before',
  };

  if (daysBetween <= 2) {
    return [dayBefore, dayOf];
  }

  const runUpEnd = addDays(eventDate, -2);
  const runUp: CampaignPhase = {
    phaseLabel: 'Run-up',
    phaseStart: startDate,
    phaseEnd: runUpEnd,
    phaseType: 'run-up',
  };

  return [runUp, dayBefore, dayOf];
}
```

- [ ] **Step 3.4: Run tests — verify they pass**

```bash
npx vitest run tests/campaigns/phases.test.ts
```
Expected: all 8 tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/campaigns/phases.ts tests/campaigns/phases.test.ts
git commit -m "feat: add phase calculation utility with tests"
```

---

## Chunk 2: AI Generation and Actions

### Task 4: Rewrite generate.ts

**Files:**
- Modify: `src/lib/campaigns/generate.ts`
- Create: `tests/campaigns/generate.test.ts`

- [ ] **Step 4.1: Write failing tests for `enforceAdSetConstraints`**

Create `tests/campaigns/generate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { enforceAdSetConstraints } from '@/lib/campaigns/generate';
import type { AiCampaignPayload } from '@/types/campaigns';

type AdSetInput = AiCampaignPayload['ad_sets'][number];

function makeAd(overrides: Partial<AdSetInput['ads'][number]> = {}): AdSetInput['ads'][number] {
  return {
    name: 'Variation 1',
    headline: 'Test headline',
    primary_text: 'Test primary text for this ad variation.',
    description: 'Test desc',
    cta: 'LEARN_MORE',
    angle: 'Value for money',
    creative_brief: 'Show a happy group',
    ...overrides,
  };
}

function makeAdSet(ads: AdSetInput['ads']): AdSetInput {
  return {
    name: 'Test Ad Set',
    phase_label: 'Run-up',
    phase_start: '2026-03-10',
    phase_end: '2026-03-16',
    audience_description: 'Local adults 25-45',
    targeting: {
      age_min: 25,
      age_max: 45,
      geo_locations: { countries: ['GB'] },
    },
    placements: 'AUTO',
    optimisation_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    ads,
  };
}

describe('enforceAdSetConstraints', () => {
  it('trims to exactly 3 ads when AI returns more', () => {
    const adSet = makeAdSet([makeAd(), makeAd(), makeAd(), makeAd(), makeAd()]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
  });

  it('pads to 3 ads when AI returns fewer (duplicates last)', () => {
    const adSet = makeAdSet([makeAd({ headline: 'Only one' })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
    expect(result.ads[1].headline).toBe('Only one');
    expect(result.ads[2].headline).toBe('Only one');
  });

  it('keeps exactly 3 ads unchanged', () => {
    const ads = [makeAd({ angle: 'A' }), makeAd({ angle: 'B' }), makeAd({ angle: 'C' })];
    const adSet = makeAdSet(ads);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads).toHaveLength(3);
    expect(result.ads[0].angle).toBe('A');
  });

  it('throws if AI returns 0 ads', () => {
    const adSet = makeAdSet([]);
    expect(() => enforceAdSetConstraints(adSet)).toThrow();
  });

  it('truncates headline to 40 chars', () => {
    const adSet = makeAdSet([makeAd({ headline: 'A'.repeat(50) })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].headline).toHaveLength(40);
  });

  it('truncates primary_text to 350 chars', () => {
    const adSet = makeAdSet([makeAd({ primary_text: 'A'.repeat(400) })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].primary_text).toHaveLength(350);
  });

  it('truncates description to 25 chars', () => {
    const adSet = makeAdSet([makeAd({ description: 'A'.repeat(30) })]);
    const result = enforceAdSetConstraints(adSet);
    expect(result.ads[0].description).toHaveLength(25);
  });
});
```

- [ ] **Step 4.2: Run tests — verify they fail on 3-variation assertions**

```bash
npx vitest run tests/campaigns/generate.test.ts
```
Expected: FAIL — `enforceAdSetConstraints` currently enforces 5, not 3. Tests for `primary_text` limit will also fail (currently 125).

- [ ] **Step 4.3: Rewrite generate.ts**

Replace the full contents of `src/lib/campaigns/generate.ts`.

> **New `generateCampaign` signature** (replacing the old one that took `startDate`/`endDate` directly):
> `generateCampaign(input: GenerateInput): Promise<AiCampaignPayload>`
> where `GenerateInput.phases: CampaignPhase[]` replaces the old `startDate`/`endDate` fields.

Full file replacement:

```typescript
import OpenAI from 'openai';

import { env } from '@/env';
import type { AiCampaignPayload, BudgetType } from '@/types/campaigns';
import type { CampaignPhase } from './phases'; // ← must import from phases.ts

interface GenerateInput {
  problemBrief: string;
  venueName: string;
  venueLocation: string;
  budgetAmount: number;
  budgetType: BudgetType;
  phases: CampaignPhase[]; // ← pre-calculated, replaces startDate/endDate
}

const SYSTEM_PROMPT = `You are an expert Meta (Facebook/Instagram) advertising strategist specialising in conversion-focused ad copy for UK hospitality venues.

Before writing any copy:
1. Identify the 3–5 strongest USPs from the brief (specific names, prices, mechanics, atmosphere details)
2. Assign each ad a distinct angle — no two ads in the same ad set may share an angle

COPY RULES:
- headline: max 40 characters — punchy, specific, no generic phrases
- primary_text: 250–350 characters — follow this 3-part formula:
  • Line 1 (hook): bold statement, provocative question, or single most compelling specific detail — must name a number, prize, price, or mechanic from the brief
  • Lines 2–3 (USP detail): specific facts from the brief — prices, mechanics, atmosphere, social context
  • Final sentence (soft CTA): conversational nudge specific to the event — not a duplicate of the button
- description: max 25 characters
- BANNED phrases (do not use any of these): "don't miss out", "join the fun", "exciting", "amazing", "don't miss", "hurry" — earn engagement through specifics, not adjectives
- Each ad must have a distinct angle from this list (or a more relevant one from the brief): "Jackpot & prize mechanic", "Social & group night", "Value for money", "Urgency & FOMO", "Food & atmosphere", "Accessibility & ease"
- CTA can vary across variations (treat as a learning dimension)
- Valid CTAs: LEARN_MORE, SIGN_UP, BOOK_NOW, GET_QUOTE, CONTACT_US, SUBSCRIBE

PHASE STRATEGY (adjust tone per phase):
- run-up: build awareness and excitement, lead with the strongest hooks
- day-before: urgency — last chance, spots running out, momentum building
- day-of: immediacy — tonight, get there, doors open soon

META API VALUES:
- Use real Meta API objective values: OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES
- Use real Meta optimisation goals: REACH, LINK_CLICKS, LEAD_GENERATION, OFFSITE_CONVERSIONS, POST_ENGAGEMENT
- Targeting geo_locations should use UK cities or country code 'GB'
- Return ONLY valid JSON matching the specified schema, no markdown, no code fences

SPECIAL AD CATEGORIES: If the brief relates to housing, employment, credit, or political issues, set special_ad_category accordingly. Otherwise use "NONE".`;

export function enforceAdSetConstraints(
  adSet: AiCampaignPayload['ad_sets'][number],
): AiCampaignPayload['ad_sets'][number] {
  let ads = [...adSet.ads];

  if (ads.length === 0) {
    throw new Error(`Ad set "${adSet.name}" returned no ads from AI — cannot enforce constraints.`);
  }

  // Trim to 3
  if (ads.length > 3) ads = ads.slice(0, 3);

  // Pad to 3 by duplicating last entry
  while (ads.length < 3) {
    ads.push({ ...ads[ads.length - 1]! });
  }

  // Enforce character limits
  ads = ads.map((ad) => ({
    ...ad,
    headline:     ad.headline.length > 40  ? ad.headline.slice(0, 40)       : ad.headline,
    primary_text: ad.primary_text.length > 350 ? ad.primary_text.slice(0, 350) : ad.primary_text,
    description:  ad.description.length > 25 ? ad.description.slice(0, 25)  : ad.description,
  }));

  return { ...adSet, ads };
}

export async function generateCampaign(input: GenerateInput): Promise<AiCampaignPayload> {
  const client = new OpenAI({ apiKey: env.server.OPENAI_API_KEY });

  const phaseDescriptions = input.phases
    .map((p, i) => {
      const dateRange = p.phaseEnd
        ? `${p.phaseStart} to ${p.phaseEnd}`
        : `${p.phaseStart}${p.adsStopTime ? ` (stop ads at ${p.adsStopTime})` : ''}`;
      return `  ${i + 1}. ${p.phaseLabel} (${p.phaseType}): ${dateRange}`;
    })
    .join('\n');

  const userPrompt = `Business brief: ${input.problemBrief}
Venue: ${input.venueName}, ${input.venueLocation}
Budget: £${input.budgetAmount} (${input.budgetType})

Phase structure (pre-calculated — use EXACTLY these dates, do not modify):
${phaseDescriptions}

Generate a Meta campaign with one ad set per phase above. Each ad set must contain EXACTLY 3 ads, each with a different angle.

Return JSON matching this exact schema:
{
  "objective": "OUTCOME_LEADS",
  "rationale": "string explaining strategy and why each phase is structured this way",
  "campaign_name": "string",
  "special_ad_category": "NONE",
  "ad_sets": [
    {
      "name": "string (e.g. 'Run-up — Jackpot Night 18 Mar')",
      "phase_label": "Run-up",
      "phase_start": "YYYY-MM-DD",
      "phase_end": "YYYY-MM-DD or null",
      "audience_description": "string describing who this targets",
      "targeting": {
        "age_min": 25,
        "age_max": 55,
        "genders": [1, 2],
        "geo_locations": { "countries": ["GB"] },
        "interests": [{ "id": "string", "name": "string" }]
      },
      "placements": "AUTO",
      "optimisation_goal": "LINK_CLICKS",
      "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
      "ads": [
        {
          "name": "Variation 1",
          "headline": "string (max 40 chars, specific detail from brief)",
          "primary_text": "string (250–350 chars, hook + USP detail + soft CTA)",
          "description": "string (max 25 chars)",
          "cta": "LEARN_MORE",
          "angle": "Jackpot & prize mechanic",
          "creative_brief": "string describing the ideal image or video for this ad"
        }
      ]
    }
  ]
}
The ads array must contain EXACTLY 3 entries per ad set. Each must have a different angle.`;

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

  // Enforce 3 ads per ad set and character limits
  payload.ad_sets = payload.ad_sets.map(enforceAdSetConstraints);

  return payload;
}
```

- [ ] **Step 4.4: Run tests — verify they pass**

```bash
npx vitest run tests/campaigns/generate.test.ts
```
Expected: all 7 tests PASS.

- [ ] **Step 4.5: Type-check**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 4.6: Commit**

```bash
git add src/lib/campaigns/generate.ts tests/campaigns/generate.test.ts
git commit -m "feat: rewrite campaign AI prompt — 3 variations, USP extraction, angles, 350 char primary text"
```

---

### Task 5: Update server actions

**Files:**
- Modify: `src/app/(app)/campaigns/actions.ts`

- [ ] **Step 5.1: Update `GenerateCampaignInput` and `SaveCampaignMeta` to include `adsStopTime`**

In `actions.ts`, find the input type interfaces at the top and update them:

```typescript
interface GenerateCampaignInput {
  problemBrief: string;
  budgetAmount: number;
  budgetType: BudgetType;
  startDate: string;
  endDate: string;        // ← no longer optional; required for phase calculation
  adsStopTime: string;    // ← add (HH:MM)
}

interface SaveCampaignMeta {
  budgetAmount: number;
  budgetType: BudgetType;
  startDate: string;
  endDate: string;        // ← no longer optional
  adsStopTime: string;    // ← add
  problemBrief: string;
}
```

- [ ] **Step 5.2: Update `generateCampaignAction` to calculate phases and pass them in**

Replace the body of `generateCampaignAction` with:

```typescript
export async function generateCampaignAction(
  input: GenerateCampaignInput,
): Promise<{ payload: AiCampaignPayload } | { error: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // 1. Verify Meta Ads account is connected and setup_complete
  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('setup_complete, meta_account_id')
    .eq('account_id', accountId)
    .maybeSingle<{ setup_complete: boolean; meta_account_id: string }>();

  if (!adAccount?.setup_complete) {
    return {
      error:
        'Meta Ads account not connected. Please complete the Meta Ads setup in Connections before generating a campaign.',
    };
  }

  // 2. Fetch venue name
  const { data: accountRow } = await supabase
    .from('accounts')
    .select('display_name')
    .eq('id', accountId)
    .single<{ display_name: string | null }>();

  const venueName = accountRow?.display_name?.trim() || 'our venue';

  // 3. Calculate phases from dates (deterministic — AI does not decide these)
  const phases = calculatePhases(input.startDate, input.endDate, input.adsStopTime);

  try {
    const rawPayload = await generateCampaign({
      problemBrief: input.problemBrief,
      venueName,
      venueLocation: 'UK',
      budgetAmount: input.budgetAmount,
      budgetType: input.budgetType,
      phases,
    });

    // Annotate the Day Of ad set (last phase) with ads_stop_time.
    // generateCampaign returns adsets in phase order; the last one is always Day Of.
    // This bridges the gap between the form input and the AiCampaignPayload shape
    // that saveCampaignDraft reads from (adSetInput.ads_stop_time).
    const payload = {
      ...rawPayload,
      ad_sets: rawPayload.ad_sets.map((as, i) =>
        i === rawPayload.ad_sets.length - 1
          ? { ...as, ads_stop_time: input.adsStopTime }
          : as,
      ),
    };

    return { payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate campaign.';
    return { error: message };
  }
}
```

Also add the import at the top of the file:

```typescript
import { calculatePhases } from '@/lib/campaigns/phases';
```

- [ ] **Step 5.3: Update `saveCampaignDraft` to persist new fields**

In `saveCampaignDraft`, update the campaign insert to use `meta.endDate` (now non-optional):

```typescript
end_date: meta.endDate,   // was: meta.endDate ?? null
```

Update the ad set insert loop to persist the new image and stop-time fields:

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
    adset_media_asset_id: adSetInput.adset_media_asset_id ?? null,  // ← add
    adset_image_url: adSetInput.adset_image_url ?? null,              // ← add
    ads_stop_time: adSetInput.ads_stop_time ?? null,                  // ← add
    status: 'DRAFT',
  })
  .single<{ id: string }>();
```

Update the ad insert to persist `angle`:

```typescript
const { error: adError } = await supabase.from('ads').insert({
  adset_id: adSetId,
  name: adInput.name,
  headline: adInput.headline,
  primary_text: adInput.primary_text,
  description: adInput.description,
  cta: adInput.cta,
  angle: adInput.angle ?? null,          // ← add
  creative_brief: adInput.creative_brief,
  media_asset_id: adInput.media_asset_id ?? null,
  status: 'DRAFT',
});
```

- [ ] **Step 5.4: Update the DB row mappers to include new fields**

In `dbRowToAd`, add `angle`:
```typescript
function dbRowToAd(row: AdDbRow): Ad {
  return {
    // ... existing fields ...
    angle: (row as AdDbRow & { angle?: string | null }).angle ?? null,  // ← add
    // ... rest of fields ...
  };
}
```

Update `AdDbRow` interface to include `angle`:
```typescript
interface AdDbRow {
  // ... existing fields ...
  angle?: string | null;  // ← add
}
```

In `dbRowToAdSet`, add the three new fields:
```typescript
function dbRowToAdSet(row: AdSetDbRow): AdSet {
  return {
    // ... existing fields ...
    adsetMediaAssetId: (row as AdSetDbRow & { adset_media_asset_id?: string | null }).adset_media_asset_id ?? null,
    adsetImageUrl: (row as AdSetDbRow & { adset_image_url?: string | null }).adset_image_url ?? null,
    adsStopTime: (row as AdSetDbRow & { ads_stop_time?: string | null }).ads_stop_time ?? null,
    // ... rest of fields ...
  };
}
```

Update `AdSetDbRow` interface:
```typescript
interface AdSetDbRow {
  // ... existing fields ...
  adset_media_asset_id?: string | null;
  adset_image_url?: string | null;
  ads_stop_time?: string | null;
}
```

- [ ] **Step 5.5: Type-check**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 5.6: Commit**

```bash
git add src/app/(app)/campaigns/actions.ts
git commit -m "feat: calculate phases in action, persist angle and adset image fields"
```

---

## Chunk 3: UI Changes

### Task 6: Add stop time field to CampaignBriefForm

**Files:**
- Modify: `src/features/campaigns/CampaignBriefForm.tsx`

- [ ] **Step 6.1: Add `adsStopTime` state**

After the existing `const [endDate, setEndDate] = useState('');` line, add:

```typescript
const [adsStopTime, setAdsStopTime] = useState('');
```

- [ ] **Step 6.2: Update validation in `handleGenerate`**

In `handleGenerate`, add a check for the stop time and make end date required:

```typescript
async function handleGenerate() {
  if (!problemBrief.trim() || !startDate) {
    toast.error('Please fill in the brief and start date.');
    return;
  }
  if (!endDate) {
    toast.error('Please set an end date (the event date).');
    return;
  }
  if (!adsStopTime) {
    toast.error('Please set a stop time for the day-of ads.');
    return;
  }
  if (budgetAmount <= 0) {
    toast.error('Budget must be greater than 0.');
    return;
  }
  // ... rest of function
```

- [ ] **Step 6.3: Pass `adsStopTime` to `generateCampaignAction`**

Update the call to `generateCampaignAction`:

```typescript
const result = await generateCampaignAction({
  problemBrief: problemBrief.trim(),
  budgetAmount,
  budgetType,
  startDate,
  endDate,          // no longer `endDate.trim() || null`
  adsStopTime,      // ← add
});
```

- [ ] **Step 6.4: Pass `adsStopTime` to `saveCampaignDraft`**

Update the call to `saveCampaignDraft`:

```typescript
const result = await saveCampaignDraft(aiPayload, {
  budgetAmount,
  budgetType,
  startDate,
  endDate,          // no longer `endDate.trim() || null`
  adsStopTime,      // ← add
  problemBrief: problemBrief.trim(),
});
```

- [ ] **Step 6.5: Add stop time input to the form UI**

Find the dates section in the `brief` state render (the `grid grid-cols-2` div containing start/end date inputs). Update it to a 3-column grid and add the stop time input:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div>
    <label
      className="block text-sm font-semibold text-foreground mb-1.5"
      htmlFor="start-date"
    >
      Start date <span className="text-destructive">*</span>
    </label>
    <input
      id="start-date"
      type="date"
      value={startDate}
      onChange={(e) => setStartDate(e.target.value)}
      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
    />
  </div>

  <div>
    <label
      className="block text-sm font-semibold text-foreground mb-1.5"
      htmlFor="end-date"
    >
      Event date <span className="text-destructive">*</span>
    </label>
    <input
      id="end-date"
      type="date"
      value={endDate}
      onChange={(e) => setEndDate(e.target.value)}
      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
    />
  </div>
</div>

<div className="max-w-xs">
  <label
    className="block text-sm font-semibold text-foreground mb-1.5"
    htmlFor="ads-stop-time"
  >
    Stop ads at <span className="text-destructive">*</span>
  </label>
  <p className="text-xs text-muted-foreground mb-1.5">
    Set to event start time — ads on the day stop here.
  </p>
  <input
    id="ads-stop-time"
    type="time"
    value={adsStopTime}
    onChange={(e) => setAdsStopTime(e.target.value)}
    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
  />
</div>
```

Note: Remove the "(optional)" label from the end date and change its label to "Event date".

- [ ] **Step 6.6: Update the Generate button disabled condition**

```tsx
<Button onClick={handleGenerate} disabled={!problemBrief.trim() || !startDate || !endDate || !adsStopTime}>
  Generate Campaign
</Button>
```

- [ ] **Step 6.7: Type-check and verify no regressions**

```bash
npm run typecheck && npm run lint
```
Expected: zero errors, zero warnings.

- [ ] **Step 6.8: Commit**

```bash
git add src/features/campaigns/CampaignBriefForm.tsx
git commit -m "feat: add stop-time field and make event date required in campaign brief form"
```

---

### Task 7: Update CampaignTree — angle labels and character count

**Files:**
- Modify: `src/features/campaigns/CampaignTree.tsx`

- [ ] **Step 7.1: Add angle labels to variation nodes in the left tree panel**

Find the ad node button in the left panel (the one that renders "Variation {di + 1}"). Replace it:

```tsx
<button
  key={di}
  type="button"
  onClick={() => setSelected({ type: 'ad', adsetIndex: ai, adIndex: di })}
  className={`w-full rounded-md pl-6 pr-2 py-1.5 text-left text-xs transition-colors ${
    selected.type === 'ad' &&
    selected.adsetIndex === ai &&
    selected.adIndex === di
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  }`}
>
  <span className="truncate block">Variation {di + 1}</span>
  {ad.angle && (
    <span className="truncate block text-[10px] opacity-70 italic leading-tight">
      {ad.angle}
    </span>
  )}
</button>
```

- [ ] **Step 7.2: Update primary text character count display from 125 → 350**

In the `renderCentrePanel` function, find the primary text field label and update it:

```tsx
<label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor="ad-primary-text">
  Primary text{' '}
  <span className={`font-normal ${
    ad.primary_text.length > 350
      ? 'text-destructive'
      : ad.primary_text.length > 300
        ? 'text-amber-500'
        : 'text-muted-foreground'
  }`}>
    ({ad.primary_text.length}/350)
  </span>
</label>
```

Also update the textarea: remove `maxLength={125}` and change to `maxLength={350}` and increase rows:

```tsx
<textarea
  id="ad-primary-text"
  maxLength={350}
  value={ad.primary_text}
  onChange={(e) => updateAd({ primary_text: e.target.value })}
  rows={6}
  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all resize-none"
/>
```

- [ ] **Step 7.3: Make creative brief collapsible**

At the top of the `CampaignTree` component function, add state for collapsed briefs:

```typescript
const [briefOpen, setBriefOpen] = useState<Record<string, boolean>>({});
```

Replace the creative brief section in `renderCentrePanel` (the `<p>` block showing `ad.creative_brief`):

```tsx
<div>
  <button
    type="button"
    onClick={() => {
      const key = `${selected.type === 'ad' ? selected.adsetIndex : 0}-${selected.type === 'ad' ? selected.adIndex : 0}`;
      setBriefOpen((prev) => ({ ...prev, [key]: !prev[key] }));
    }}
    className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
  >
    <ChevronRight
      className={`h-3 w-3 transition-transform ${
        briefOpen[`${(selected as {adsetIndex:number}).adsetIndex}-${(selected as {adIndex:number}).adIndex}`]
          ? 'rotate-90'
          : ''
      }`}
    />
    <span className="italic">AI creative intent</span>
  </button>
  {briefOpen[`${(selected as {adsetIndex:number}).adsetIndex}-${(selected as {adIndex:number}).adIndex}`] && (
    <p className="mt-1.5 text-xs italic text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
      {ad.creative_brief}
    </p>
  )}
</div>
```

- [ ] **Step 7.4: Type-check**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 7.5: Commit**

```bash
git add src/features/campaigns/CampaignTree.tsx
git commit -m "feat: add angle labels, 350-char counter, and collapsible creative brief to campaign tree"
```

---

### Task 8: CampaignTree — ad set image picker and apply-to-all

**Files:**
- Modify: `src/features/campaigns/CampaignTree.tsx`

- [ ] **Step 8.1: Add adset-level picker state**

At the top of the `CampaignTree` component, add a second picker state for the adset-level picker:

```typescript
const [adsetPickerOpen, setAdsetPickerOpen] = useState(false);
```

Rename the existing `pickerOpen` → keep as is (it's for individual variation picker). The adset picker is `adsetPickerOpen`.

- [ ] **Step 8.2: Add image helper — `getEffectiveImage`**

Add this helper inside the component (before `renderCentrePanel`):

```typescript
function getEffectiveImage(adsetIdx: number, adIdx: number): string | undefined {
  const adset = payload.ad_sets[adsetIdx];
  const ad = adset?.ads[adIdx];
  if (!adset || !ad) return undefined;
  // Variation override takes priority; fall back to adset-level image
  return ad.image_url ?? adset.adset_image_url ?? undefined;
}
```

- [ ] **Step 8.3: Add ad set-level image picker to the adset centre panel**

In `renderCentrePanel`, find the adset panel (the `selected.type === 'adset'` branch). At the bottom of the adset space-y-4 div, after the phase window section, add:

```tsx
{/* Ad set shared image */}
<div>
  <p className="text-xs font-semibold text-muted-foreground mb-1">
    Ad Set Image{' '}
    <span className="font-normal italic">— applies to all variations</span>
  </p>

  {adset.adset_image_url && (
    <div className="mb-2 relative w-20 h-20 rounded overflow-hidden border border-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={adset.adset_image_url}
        alt="Ad set image"
        className="w-full h-full object-cover"
      />
    </div>
  )}

  <button
    type="button"
    onClick={() => setAdsetPickerOpen((v) => !v)}
    className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
  >
    {adset.adset_image_url ? 'Change ad set image' : 'Set image for all variations'}
  </button>

  {adsetPickerOpen && (
    <div className="mt-2 rounded-md border border-border bg-background p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Select an image — applies to all variations in this ad set:
      </p>
      {mediaLibrary.length === 0 ? (
        <p className="text-xs text-muted-foreground">No images in your library yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {(() => {
            // Capture narrowed value before closures — TypeScript narrowing is not
            // preserved inside onClick callbacks at runtime.
            const adsetIdx = selected.adsetIndex;
            return mediaLibrary
            .filter((asset) => asset.mediaType === 'image' && asset.aspectClass === 'square')
            .map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => {
                  // Set adset-level image and clear all variation overrides
                  const adSets = payload.ad_sets.map((as, i) => {
                    if (i !== adsetIdx) return as;
                    return {
                      ...as,
                      adset_media_asset_id: asset.id,
                      adset_image_url: asset.previewUrl ?? undefined,
                      // Clear individual variation overrides
                      ads: as.ads.map((ad) => ({
                        ...ad,
                        image_url: undefined,
                        media_asset_id: undefined,
                      })),
                    };
                  });
                  onChange({ ...payload, ad_sets: adSets });
                  setAdsetPickerOpen(false);
                }}
                className={`relative aspect-square w-full rounded overflow-hidden border-2 transition-colors ${
                  adset.adset_media_asset_id === asset.id
                    ? 'border-primary'
                    : 'border-transparent hover:border-border'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.previewUrl ?? ''}
                  alt={asset.fileName}
                  className="w-full h-full object-cover"
                />
              </button>
            ))
            );
          })()}
        </div>
      )}
    </div>
  )}
</div>
```

Note: `adsetIdx` is captured via an IIFE before the map/onClick closures — this ensures TypeScript narrowing on `selected.adsetIndex` is preserved at the point of use inside callbacks.

- [ ] **Step 8.4: Add "Apply to all" button to individual variation picker**

In the `renderCentrePanel` ad branch, find the image picker section. After the `pickerOpen` grid closes, add the "Apply to all" button. The full updated image section:

```tsx
{/* Show effective image if one is set */}
{getEffectiveImage(selected.adsetIndex, selected.adIndex) && (
  <div className="flex items-start gap-2">
    <div className="relative w-16 h-16 rounded overflow-hidden border border-border flex-shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getEffectiveImage(selected.adsetIndex, selected.adIndex)}
        alt="Selected creative"
        className="w-full h-full object-cover"
      />
    </div>
    {!ad.image_url && (
      <span className="text-[10px] text-muted-foreground italic pt-1">
        Inherited from ad set
      </span>
    )}
  </div>
)}

<div className="flex flex-wrap gap-2">
  <button
    type="button"
    onClick={() => setPickerOpen((v) => !v)}
    className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
  >
    {ad.image_url ? 'Change creative' : 'Pick creative from library'}
  </button>

  {/* Apply to all — only show if this variation has its own image */}
  {ad.image_url && (() => {
    // Capture narrowed value before closure — TypeScript narrowing not preserved inside callbacks
    const adsetIdx = selected.adsetIndex;
    return (
    <button
      type="button"
      onClick={() => {
        const adSets = payload.ad_sets.map((as, ai) => {
          if (ai !== adsetIdx) return as;
          return {
            ...as,
            adset_media_asset_id: ad.media_asset_id ?? undefined,
            adset_image_url: ad.image_url ?? undefined,
            // Null out all variation overrides (including this one)
            ads: as.ads.map((a) => ({
              ...a,
              image_url: undefined,
              media_asset_id: undefined,
            })),
          };
        });
        onChange({ ...payload, ad_sets: adSets });
      }}
      className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      Apply to all in this ad set
    </button>
    );
  })()}
</div>

{pickerOpen && (
  <div className="rounded-md border border-border bg-background p-3 space-y-2">
    <p className="text-xs font-medium text-muted-foreground">Select an image from your library:</p>
    {mediaLibrary.length === 0 ? (
      <p className="text-xs text-muted-foreground">No images in your library yet.</p>
    ) : (
      <div className="grid grid-cols-3 gap-2">
        {mediaLibrary
          .filter((asset) => asset.mediaType === 'image' && asset.aspectClass === 'square')
          .map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => {
                updateAd({ image_url: asset.previewUrl, media_asset_id: asset.id });
                setPickerOpen(false);
              }}
              className={`relative aspect-square w-full rounded overflow-hidden border-2 transition-colors ${
                ad.media_asset_id === asset.id
                  ? 'border-primary'
                  : 'border-transparent hover:border-border'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.previewUrl ?? ''}
                alt={asset.fileName}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 8.5: Add "custom" badge to variation nodes that have their own image**

In the variation node button in the left tree (updated in Task 7.1), add a badge after the angle label:

```tsx
<span className="truncate block">Variation {di + 1}</span>
{ad.angle && (
  <span className="truncate block text-[10px] opacity-70 italic leading-tight">
    {ad.angle}
  </span>
)}
{ad.media_asset_id && (
  <span className="inline-block text-[9px] bg-current/10 rounded px-1 leading-tight opacity-60">
    custom image
  </span>
)}
```

- [ ] **Step 8.6: Update AdPreview to use effective image**

In `renderPreviewPanel`, pass the effective image to `AdPreview` instead of just `ad.image_url`:

```tsx
<AdPreview
  headline={ad.headline}
  primaryText={ad.primary_text}
  cta={ad.cta as CtaType}
  imageUrl={getEffectiveImage(selected.adsetIndex, selected.adIndex)}
/>
```

- [ ] **Step 8.7: Type-check and lint**

```bash
npm run typecheck && npm run lint
```
Expected: zero errors, zero warnings.

- [ ] **Step 8.8: Run all tests**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 8.9: Commit**

```bash
git add src/features/campaigns/CampaignTree.tsx
git commit -m "feat: add ad set-level image picker, apply-to-all button, and custom image badge to campaign tree"
```

---

## Final Verification

- [ ] **Step 9.1: Full CI pipeline**

```bash
npm run ci:verify
```
Expected: lint ✓, typecheck ✓, test ✓, build ✓.

- [ ] **Step 9.2: Smoke test — generate a campaign**

Start the dev server (`npm run dev`) and:
1. Go to `/campaigns/new`
2. Fill in a brief with detailed event info (name, price, prizes, mechanics)
3. Set start date, event date, stop time
4. Click Generate — verify the AI copy is longer, uses specific USPs, and each variation has a different angle label in the tree
5. Select an ad set node — verify the "Set image for all variations" picker appears
6. Select a variation, pick an image, verify "Apply to all in this ad set" appears
7. Click "Apply to all" — verify all 3 variations now show the inherited image badge in the tree
8. Verify the character counter on primary text shows amber/red correctly
9. Save draft — verify it saves without errors

- [ ] **Step 9.3: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: resolve issues found during smoke test"
```
