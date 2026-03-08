# Meta Paid Media Campaigns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Campaigns section that uses AI to generate Meta (Facebook/Instagram) paid media campaigns from a business problem brief, and publishes them live via the Marketing API.

**Architecture:** Three-phase delivery — Phase 1 lays the database and OAuth foundation; Phase 2 adds AI generation and the campaign builder UI; Phase 3 wires up Meta API publishing, the campaign list, and a daily sync cron. Each phase is independently deployable.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS, Supabase (PostgreSQL + RLS), OpenAI (structured JSON output), Meta Marketing API v24.0, Vitest

---

## Codebase Orientation

Key files to understand before starting:

- `src/lib/meta/graph.ts` — existing Meta Graph API base URL helper
- `src/lib/connections/oauth.ts` — existing Facebook/Instagram OAuth scope builder
- `src/app/(app)/connections/actions.ts` — server action pattern for OAuth (copy this pattern)
- `src/components/layout/Sidebar.tsx` — `NAV_ITEMS` array — add Campaigns here
- `src/app/(app)/` — route group for authenticated pages — all new routes go here
- `tests/` — all test files live here (NOT alongside source)
- `vitest.config.ts` — `include: ["tests/**/*.test.ts"]`
- `supabase/migrations/` — migration files, named `YYYYMMDDHHMMSS_description.sql`

DB uses `current_account_id()` for RLS scoping. All tables use `account_id` (not `venue_id` — check existing tables for the exact column name convention).

---

## Phase 1: Database, OAuth Extension, Ad Account Setup

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260308120000_add_meta_campaigns.sql`

**Step 1: Write the migration**

```sql
-- Meta Ad Account connection (one per account)
create table public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users on delete cascade,
  meta_account_id text not null,
  currency text not null default 'GBP',
  timezone text not null default 'Europe/London',
  access_token text not null,
  token_expires_at timestamptz,
  setup_complete boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.meta_ad_accounts enable row level security;

create policy "Users can manage their own ad account"
  on public.meta_ad_accounts
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

-- Campaigns
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users on delete cascade,
  meta_campaign_id text,
  name text not null,
  objective text not null,
  problem_brief text not null,
  ai_rationale text,
  budget_type text not null default 'DAILY',
  budget_amount numeric not null,
  start_date date not null,
  end_date date,
  status text not null default 'DRAFT',
  meta_status text,
  special_ad_category text not null default 'NONE',
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;

create policy "Users can manage their own campaigns"
  on public.campaigns
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());

-- Ad Sets
create table public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns on delete cascade,
  meta_adset_id text,
  name text not null,
  targeting jsonb not null default '{}',
  placements jsonb not null default '"AUTO"',
  budget_amount numeric,
  optimisation_goal text not null,
  bid_strategy text not null default 'LOWEST_COST_WITHOUT_CAP',
  status text not null default 'DRAFT',
  created_at timestamptz not null default now()
);

alter table public.ad_sets enable row level security;

create policy "Users can manage ad sets via campaign ownership"
  on public.ad_sets
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and c.account_id = public.current_account_id()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and c.account_id = public.current_account_id()
    )
  );

-- Ads
create table public.ads (
  id uuid primary key default gen_random_uuid(),
  adset_id uuid not null references public.ad_sets on delete cascade,
  meta_ad_id text,
  meta_creative_id text,
  name text not null,
  headline text not null,
  primary_text text not null,
  description text not null,
  cta text not null default 'LEARN_MORE',
  media_asset_id uuid,
  creative_brief text,
  preview_url text,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now()
);

alter table public.ads enable row level security;

create policy "Users can manage ads via campaign ownership"
  on public.ads
  using (
    exists (
      select 1 from public.ad_sets s
      join public.campaigns c on c.id = s.campaign_id
      where s.id = adset_id
        and c.account_id = public.current_account_id()
    )
  )
  with check (
    exists (
      select 1 from public.ad_sets s
      join public.campaigns c on c.id = s.campaign_id
      where s.id = adset_id
        and c.account_id = public.current_account_id()
    )
  );
```

**Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected: migration applied with no errors.

**Step 3: Commit**

```bash
git add supabase/migrations/20260308120000_add_meta_campaigns.sql
git commit -m "feat: add meta campaigns database schema"
```

---

### Task 2: TypeScript types

**Files:**
- Create: `src/types/campaigns.ts`

**Step 1: Write the types**

```typescript
export type CampaignObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES';

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type AdSetStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';
export type AdStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';
export type BudgetType = 'DAILY' | 'LIFETIME';
export type SpecialAdCategory = 'NONE' | 'HOUSING' | 'EMPLOYMENT' | 'CREDIT' | 'ISSUES_ELECTIONS_POLITICS';
export type CtaType = 'LEARN_MORE' | 'SIGN_UP' | 'GET_QUOTE' | 'BOOK_NOW' | 'CONTACT_US' | 'SUBSCRIBE';

export interface MetaAdAccount {
  id: string;
  accountId: string;
  metaAccountId: string;
  currency: string;
  timezone: string;
  tokenExpiresAt: Date | null;
  setupComplete: boolean;
  createdAt: Date;
}

export interface AdTargeting {
  age_min: number;
  age_max: number;
  genders?: number[];
  geo_locations: {
    cities?: Array<{ key: string; name: string; region: string; country: string }>;
    countries?: string[];
  };
  interests?: Array<{ id: string; name: string }>;
}

export interface Ad {
  id: string;
  adsetId: string;
  metaAdId: string | null;
  metaCreativeId: string | null;
  name: string;
  headline: string;
  primaryText: string;
  description: string;
  cta: CtaType;
  mediaAssetId: string | null;
  creativeBrief: string | null;
  previewUrl: string | null;
  status: AdStatus;
  createdAt: Date;
}

export interface AdSet {
  id: string;
  campaignId: string;
  metaAdsetId: string | null;
  name: string;
  targeting: AdTargeting;
  placements: 'AUTO' | object;
  budgetAmount: number | null;
  optimisationGoal: string;
  bidStrategy: string;
  status: AdSetStatus;
  createdAt: Date;
  ads?: Ad[];
}

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
  specialAdCategory: SpecialAdCategory;
  lastSyncedAt: Date | null;
  createdAt: Date;
  adSets?: AdSet[];
}

// AI generation output shape
export interface AiCampaignPayload {
  objective: CampaignObjective;
  rationale: string;
  campaign_name: string;
  special_ad_category: SpecialAdCategory;
  ad_sets: Array<{
    name: string;
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
    }>;
  }>;
}
```

**Step 2: Write tests for type guards**

Create `tests/lib/campaigns/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AiCampaignPayload } from '@/types/campaigns';

describe('AiCampaignPayload', () => {
  it('should accept a valid payload', () => {
    const payload: AiCampaignPayload = {
      objective: 'OUTCOME_LEADS',
      rationale: 'Test rationale',
      campaign_name: 'Test Campaign',
      special_ad_category: 'NONE',
      ad_sets: [
        {
          name: 'Local Audience',
          audience_description: 'People near the venue',
          targeting: {
            age_min: 25,
            age_max: 55,
            geo_locations: { countries: ['GB'] },
          },
          placements: 'AUTO',
          optimisation_goal: 'LEAD_GENERATION',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ads: [
            {
              name: 'Ad 1',
              headline: 'Visit Us Tonight',
              primary_text: 'Great offers await.',
              description: 'Book now',
              cta: 'BOOK_NOW',
              creative_brief: 'Warm, inviting bar atmosphere',
            },
          ],
        },
      ],
    };
    expect(payload.objective).toBe('OUTCOME_LEADS');
    expect(payload.ad_sets[0].ads[0].headline.length).toBeLessThanOrEqual(40);
  });
});
```

**Step 3: Run the test**

```bash
npx vitest run tests/lib/campaigns/types.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/types/campaigns.ts tests/lib/campaigns/types.test.ts
git commit -m "feat: add campaigns TypeScript types"
```

---

### Task 3: Meta ads OAuth flow

The existing Facebook connection covers page management. The ads connection is a separate OAuth flow requesting additional scopes and storing the token in `meta_ad_accounts`.

**Files:**
- Modify: `src/lib/connections/oauth.ts`
- Create: `src/app/api/oauth/facebook-ads/callback/route.ts`
- Create: `src/app/(app)/connections/actions-ads.ts`

**Step 1: Add ads scope builder to oauth.ts**

In `src/lib/connections/oauth.ts`, add after the existing `FACEBOOK_SCOPES` constant:

```typescript
const FACEBOOK_ADS_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
].join(',');
```

Then add a new function at the bottom of the file:

```typescript
export function buildFacebookAdsOAuthUrl(state: string) {
  const redirectUri = `${SITE_URL}/api/oauth/facebook-ads/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: FACEBOOK_ADS_SCOPES,
    response_type: 'code',
  });
  return `${getMetaOAuthBase()}/dialog/oauth?${params.toString()}`;
}
```

**Step 2: Write tests for the URL builder**

Create `tests/lib/campaigns/oauth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/env', () => ({
  env: {
    client: {
      NEXT_PUBLIC_FACEBOOK_APP_ID: 'test-app-id',
      NEXT_PUBLIC_SITE_URL: 'https://example.com',
      NEXT_PUBLIC_META_GRAPH_VERSION: 'v24.0',
    },
    server: {
      META_GRAPH_VERSION: '',
    },
  },
}));

import { buildFacebookAdsOAuthUrl } from '@/lib/connections/oauth';

describe('buildFacebookAdsOAuthUrl', () => {
  it('should include ads_management scope', () => {
    const url = buildFacebookAdsOAuthUrl('test-state-123');
    expect(url).toContain('ads_management');
    expect(url).toContain('ads_read');
    expect(url).toContain('state=test-state-123');
    expect(url).toContain('facebook-ads/callback');
  });
});
```

**Step 3: Run tests**

```bash
npx vitest run tests/lib/campaigns/oauth.test.ts
```

Expected: FAIL (function not yet exported).

**Step 4: Apply the changes to oauth.ts, re-run**

```bash
npx vitest run tests/lib/campaigns/oauth.test.ts
```

Expected: PASS.

**Step 5: Create the OAuth callback route**

Create `src/app/api/oauth/facebook-ads/callback/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/env';
import { getMetaGraphApiBase } from '@/lib/meta/graph';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(`${SITE_URL}/connections?ads_error=access_denied`);
  }

  try {
    const supabase = createServiceSupabaseClient();

    // Verify state token
    const { data: stateRow } = await supabase
      .from('oauth_states')
      .select('account_id, used_at')
      .eq('state', state)
      .is('used_at', null)
      .single();

    if (!stateRow) {
      return NextResponse.redirect(`${SITE_URL}/connections?ads_error=invalid_state`);
    }

    // Mark state as used
    await supabase
      .from('oauth_states')
      .update({ used_at: new Date().toISOString() })
      .eq('state', state);

    // Exchange code for token
    const redirectUri = `${SITE_URL}/api/oauth/facebook-ads/callback`;
    const tokenUrl = `${getMetaGraphApiBase()}/oauth/access_token`;
    const tokenParams = new URLSearchParams({
      client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
      client_secret: env.server.FACEBOOK_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    });

    const tokenRes = await fetch(`${tokenUrl}?${tokenParams}`);
    const tokenData = await tokenRes.json() as { access_token?: string; expires_in?: number; error?: unknown };

    if (!tokenData.access_token) {
      return NextResponse.redirect(`${SITE_URL}/connections?ads_error=token_exchange_failed`);
    }

    // Exchange for long-lived token
    const longLivedParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
      client_secret: env.server.FACEBOOK_APP_SECRET,
      fb_exchange_token: tokenData.access_token,
    });

    const llRes = await fetch(`${getMetaGraphApiBase()}/oauth/access_token?${longLivedParams}`);
    const llData = await llRes.json() as { access_token?: string; expires_in?: number };

    const accessToken = llData.access_token ?? tokenData.access_token;
    const expiresIn = llData.expires_in ?? tokenData.expires_in ?? 5184000; // 60 days default
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Upsert into meta_ad_accounts (partial — account selection happens next)
    await supabase
      .from('meta_ad_accounts')
      .upsert(
        {
          account_id: stateRow.account_id,
          access_token: accessToken,
          token_expires_at: expiresAt,
          setup_complete: false,
          // meta_account_id left blank until user selects it
          meta_account_id: '',
          currency: 'GBP',
          timezone: 'Europe/London',
        },
        { onConflict: 'account_id' }
      );

    return NextResponse.redirect(`${SITE_URL}/connections?ads_step=select_account`);
  } catch (err) {
    console.error('[facebook-ads callback]', err);
    return NextResponse.redirect(`${SITE_URL}/connections?ads_error=unexpected`);
  }
}
```

**Step 6: Create ads-specific server actions**

Create `src/app/(app)/connections/actions-ads.ts`:

```typescript
'use server';

import { randomUUID } from 'crypto';

import { requireAuthContext } from '@/lib/auth/server';
import { buildFacebookAdsOAuthUrl } from '@/lib/connections/oauth';
import { getMetaGraphApiBase } from '@/lib/meta/graph';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

export async function startAdsOAuth(): Promise<{ url: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();
  const state = randomUUID();

  await supabase.from('oauth_states').insert({
    state,
    account_id: accountId,
    provider: 'facebook_ads',
  });

  const url = buildFacebookAdsOAuthUrl(state);
  return { url };
}

export async function fetchAdAccounts(): Promise<
  { success: true; accounts: Array<{ id: string; name: string; currency: string; timezone_name: string }> } |
  { success: false; error: string }
> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('access_token')
    .eq('account_id', accountId)
    .single();

  if (!adAccount?.access_token) {
    return { success: false, error: 'No ads token found. Please connect first.' };
  }

  const url = `${getMetaGraphApiBase()}/me/adaccounts?fields=id,name,currency,timezone_name&access_token=${adAccount.access_token}`;
  const res = await fetch(url);
  const data = await res.json() as { data?: Array<{ id: string; name: string; currency: string; timezone_name: string }>; error?: { message: string } };

  if (data.error) {
    return { success: false, error: data.error.message };
  }

  return { success: true, accounts: data.data ?? [] };
}

export async function selectAdAccount(
  metaAccountId: string
): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Fetch account details from Meta to get currency/timezone
  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('access_token')
    .eq('account_id', accountId)
    .single();

  if (!adAccount?.access_token) {
    return { error: 'No ads token found.' };
  }

  const url = `${getMetaGraphApiBase()}/${metaAccountId}?fields=currency,timezone_name&access_token=${adAccount.access_token}`;
  const res = await fetch(url);
  const details = await res.json() as { currency?: string; timezone_name?: string; error?: { message: string } };

  if (details.error) {
    return { error: details.error.message };
  }

  await supabase
    .from('meta_ad_accounts')
    .update({
      meta_account_id: metaAccountId,
      currency: details.currency ?? 'GBP',
      timezone: details.timezone_name ?? 'Europe/London',
      setup_complete: true,
    })
    .eq('account_id', accountId);

  return { success: true };
}

export async function getAdAccountSetupStatus(): Promise<{
  connected: boolean;
  setupComplete: boolean;
  tokenExpiringSoon: boolean;
}> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data } = await supabase
    .from('meta_ad_accounts')
    .select('setup_complete, token_expires_at')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!data) return { connected: false, setupComplete: false, tokenExpiringSoon: false };

  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const tokenExpiringSoon = data.token_expires_at
    ? new Date(data.token_expires_at) < sevenDaysFromNow
    : false;

  return {
    connected: true,
    setupComplete: data.setup_complete,
    tokenExpiringSoon,
  };
}
```

**Step 7: Write tests for selectAdAccount**

Create `tests/lib/campaigns/actions-ads.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { selectAdAccount } from '@/app/(app)/connections/actions-ads';

describe('selectAdAccount', () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServiceSupabaseClient>);
    global.fetch = vi.fn();
  });

  it('should return error when no token exists', async () => {
    mockSupabase.single.mockResolvedValue({ data: null });
    const result = await selectAdAccount('act_123');
    expect(result).toEqual({ error: 'No ads token found.' });
  });

  it('should update ad account on success', async () => {
    mockSupabase.single.mockResolvedValue({
      data: { access_token: 'test-token' },
    });
    vi.mocked(global.fetch).mockResolvedValue({
      json: async () => ({ currency: 'GBP', timezone_name: 'Europe/London' }),
    } as Response);
    mockSupabase.update.mockReturnThis();
    mockSupabase.eq.mockResolvedValue({ data: null, error: null });

    const result = await selectAdAccount('act_123');
    expect(result).toEqual({ success: true });
  });
});
```

**Step 8: Run tests**

```bash
npx vitest run tests/lib/campaigns/actions-ads.test.ts
```

Expected: PASS.

**Step 9: Commit**

```bash
git add src/lib/connections/oauth.ts \
        src/app/api/oauth/facebook-ads/ \
        src/app/(app)/connections/actions-ads.ts \
        tests/lib/campaigns/
git commit -m "feat: add Meta Ads OAuth flow and ad account setup actions"
```

---

### Task 4: Ad Account setup UI in Connections

**Files:**
- Create: `src/features/campaigns/AdAccountSetup.tsx`
- Modify: `src/app/(app)/connections/page.tsx` — add the setup card

**Step 1: Create the setup component**

Create `src/features/campaigns/AdAccountSetup.tsx`:

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';

import { useToast } from '@/components/providers/toast-provider';
import {
  fetchAdAccounts,
  selectAdAccount,
  startAdsOAuth,
} from '@/app/(app)/connections/actions-ads';

interface SetupStatus {
  connected: boolean;
  setupComplete: boolean;
  tokenExpiringSoon: boolean;
}

interface Props {
  initialStatus: SetupStatus;
}

export function AdAccountSetup({ initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [adAccounts, setAdAccounts] = useState<
    Array<{ id: string; name: string; currency: string; timezone_name: string }>
  >([]);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  useEffect(() => {
    if (status.connected && !status.setupComplete) {
      fetchAdAccounts().then((result) => {
        if (result.success) setAdAccounts(result.accounts);
      });
    }
  }, [status]);

  const handleConnect = () => {
    startTransition(async () => {
      try {
        const { url } = await startAdsOAuth();
        window.location.href = url;
      } catch {
        toast.error('Could not start Meta Ads connection');
      }
    });
  };

  const handleSelect = (metaAccountId: string) => {
    startTransition(async () => {
      const result = await selectAdAccount(metaAccountId);
      if (result.success) {
        setStatus((s) => ({ ...s, setupComplete: true }));
        toast.success('Meta Ads account connected');
      } else {
        toast.error(result.error ?? 'Failed to connect ad account');
      }
    });
  };

  if (status.setupComplete) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">Meta Ads connected</p>
        <p className="text-xs text-green-600">Campaigns are unlocked.</p>
        {status.tokenExpiringSoon && (
          <button
            type="button"
            onClick={handleConnect}
            className="mt-2 text-xs text-amber-700 underline"
          >
            Token expiring soon — reconnect
          </button>
        )}
      </div>
    );
  }

  if (status.connected && adAccounts.length > 0) {
    return (
      <div className="rounded-lg border border-border p-4 space-y-3">
        <p className="text-sm font-medium">Select your Meta Ad Account</p>
        <ul className="space-y-2">
          {adAccounts.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleSelect(account.id)}
                className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
              >
                {account.name} <span className="text-muted-foreground">({account.id})</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm font-medium">Connect Meta Ads</p>
      <p className="text-xs text-muted-foreground">
        Connect your Meta Ad Account to create and publish campaigns directly from CheersAI.
      </p>
      <button
        type="button"
        onClick={handleConnect}
        disabled={isPending}
        className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:opacity-60"
      >
        {isPending ? 'Redirecting…' : 'Connect Meta Ads'}
      </button>
    </div>
  );
}
```

**Step 2: Add the card to the Connections page**

Open `src/app/(app)/connections/page.tsx`. Add the following import and render the `<AdAccountSetup>` component, passing `initialStatus` fetched server-side via `getAdAccountSetupStatus()`.

The exact location depends on the current page structure — add it as a new section after the existing connection cards.

**Step 3: Add Campaigns to the sidebar nav**

Open `src/components/layout/Sidebar.tsx`. Add to `NAV_ITEMS`:

```typescript
import { Megaphone } from 'lucide-react';

// In NAV_ITEMS array, after 'Library':
{ label: 'Campaigns', href: '/campaigns', icon: Megaphone },
```

**Step 4: Redirect the legacy campaigns route to the new one**

The existing `src/app/campaigns/page.tsx` redirects to `/planner`. Change it:

```typescript
import { permanentRedirect } from 'next/navigation';
export default function LegacyCampaignsRedirectPage() {
  permanentRedirect('/campaigns');
}
```

(The real page will be at `src/app/(app)/campaigns/` — Next.js will resolve the `(app)` group path as `/campaigns`.)

**Step 5: Type-check**

```bash
npx tsc --noEmit
```

Fix any type errors before continuing.

**Step 6: Commit**

```bash
git add src/features/campaigns/AdAccountSetup.tsx \
        src/components/layout/Sidebar.tsx \
        src/app/\(app\)/connections/page.tsx \
        src/app/campaigns/page.tsx
git commit -m "feat: add Meta Ads account setup UI and Campaigns nav item"
```

---

## Phase 2: AI Generation & Campaign Builder UI

### Task 5: AI campaign generation

**Files:**
- Create: `src/lib/campaigns/generate.ts`
- Create: `tests/lib/campaigns/generate.test.ts`

**Step 1: Write the failing test first**

Create `tests/lib/campaigns/generate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

vi.mock('@/env', () => ({
  env: {
    server: { OPENAI_API_KEY: 'test-key' },
    client: {},
  },
}));

import OpenAI from 'openai';
import { generateCampaign } from '@/lib/campaigns/generate';

const mockCreate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(OpenAI).mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }) as unknown as OpenAI);
});

describe('generateCampaign', () => {
  it('should return a parsed AI campaign payload', async () => {
    const mockPayload = {
      objective: 'OUTCOME_LEADS',
      rationale: 'Lead gen is best for this brief.',
      campaign_name: 'Tuesday Night Boost',
      special_ad_category: 'NONE',
      ad_sets: [
        {
          name: 'Local 25-45',
          audience_description: 'Local adults aged 25-45',
          targeting: {
            age_min: 25,
            age_max: 45,
            geo_locations: { countries: ['GB'] },
          },
          placements: 'AUTO',
          optimisation_goal: 'LEAD_GENERATION',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ads: [
            {
              name: 'Ad 1',
              headline: 'Quiet Tuesdays? Not Here',
              primary_text: 'Join us every Tuesday for live music and cocktail deals.',
              description: 'Book your table',
              cta: 'BOOK_NOW',
              creative_brief: 'Lively bar scene, warm lighting',
            },
          ],
        },
      ],
    };

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockPayload) } }],
    });

    const result = await generateCampaign({
      problemBrief: 'We are dead on Tuesday nights',
      venueName: 'The Anchor',
      venueLocation: 'London',
      budgetAmount: 500,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });

    expect(result.objective).toBe('OUTCOME_LEADS');
    expect(result.ad_sets).toHaveLength(1);
    expect(result.ad_sets[0].ads[0].headline.length).toBeLessThanOrEqual(40);
  });

  it('should throw if AI returns invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });

    await expect(
      generateCampaign({
        problemBrief: 'test',
        venueName: 'Test',
        venueLocation: 'London',
        budgetAmount: 100,
        budgetType: 'DAILY',
        startDate: '2026-04-01',
        endDate: null,
      })
    ).rejects.toThrow();
  });
});
```

**Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/lib/campaigns/generate.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement generate.ts**

Create `src/lib/campaigns/generate.ts`:

```typescript
import OpenAI from 'openai';

import { env } from '@/env';
import type { AiCampaignPayload } from '@/types/campaigns';

interface GenerateInput {
  problemBrief: string;
  venueName: string;
  venueLocation: string;
  budgetAmount: number;
  budgetType: 'DAILY' | 'LIFETIME';
  startDate: string;
  endDate: string | null;
}

const SYSTEM_PROMPT = `You are an expert Meta (Facebook/Instagram) advertising strategist.
Given a business problem brief, you generate a complete campaign structure.

RULES:
- headline: max 40 characters
- primary_text: max 125 characters
- description: max 25 characters
- Generate 2-3 ad sets with 2 ads each
- Use real Meta API objective values: OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES
- Use real Meta optimisation goals: REACH, LINK_CLICKS, LEAD_GENERATION, OFFSITE_CONVERSIONS, POST_ENGAGEMENT
- Targeting geo_locations should use UK cities or country code 'GB'
- Return ONLY valid JSON matching the specified schema, no markdown

SPECIAL AD CATEGORIES: If the brief relates to housing, employment, credit, or political issues, set special_ad_category to the relevant value. Otherwise use "NONE".`;

export async function generateCampaign(input: GenerateInput): Promise<AiCampaignPayload> {
  const client = new OpenAI({ apiKey: env.server.OPENAI_API_KEY });

  const userPrompt = `
Business problem: ${input.problemBrief}
Venue: ${input.venueName}, ${input.venueLocation}
Budget: £${input.budgetAmount} (${input.budgetType})
Campaign dates: ${input.startDate} to ${input.endDate ?? 'ongoing'}

Generate a Meta campaign to solve this problem. Return JSON matching this schema:
{
  "objective": "OUTCOME_LEADS",
  "rationale": "string explaining the strategy",
  "campaign_name": "string",
  "special_ad_category": "NONE",
  "ad_sets": [
    {
      "name": "string",
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
          "name": "string",
          "headline": "string (max 40 chars)",
          "primary_text": "string (max 125 chars)",
          "description": "string (max 25 chars)",
          "cta": "LEARN_MORE",
          "creative_brief": "string describing ideal image/video"
        }
      ]
    }
  ]
}`;

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

  // Validate character limits
  for (const adSet of payload.ad_sets) {
    for (const ad of adSet.ads) {
      if (ad.headline.length > 40) ad.headline = ad.headline.slice(0, 40);
      if (ad.primary_text.length > 125) ad.primary_text = ad.primary_text.slice(0, 125);
      if (ad.description.length > 25) ad.description = ad.description.slice(0, 25);
    }
  }

  return payload;
}
```

**Step 4: Run the tests**

```bash
npx vitest run tests/lib/campaigns/generate.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/campaigns/generate.ts tests/lib/campaigns/generate.test.ts
git commit -m "feat: add AI campaign generation with character limit guardrails"
```

---

### Task 6: Campaign server actions (create, save, fetch)

**Files:**
- Create: `src/app/(app)/campaigns/actions.ts`
- Create: `tests/lib/campaigns/campaign-actions.test.ts`

**Step 1: Write failing tests**

Create `tests/lib/campaigns/campaign-actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/campaigns/generate', () => ({
  generateCampaign: vi.fn(),
}));

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { generateCampaign } from '@/lib/campaigns/generate';
import { generateCampaignAction, saveCampaignDraft } from '@/app/(app)/campaigns/actions';

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServiceSupabaseClient>);
});

describe('generateCampaignAction', () => {
  it('should return error if ad account not set up', async () => {
    mockSupabase.maybeSingle.mockResolvedValue({ data: null });
    const result = await generateCampaignAction({
      problemBrief: 'We are quiet on Tuesdays',
      budgetAmount: 500,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: null,
    });
    expect(result.error).toBeDefined();
  });

  it('should call generateCampaign and return payload on success', async () => {
    mockSupabase.maybeSingle.mockResolvedValue({
      data: { setup_complete: true, meta_account_id: 'act_123', currency: 'GBP', timezone: 'Europe/London' },
    });
    // Mock venue settings fetch
    mockSupabase.single.mockResolvedValue({
      data: { name: 'The Anchor', city: 'London' },
    });
    vi.mocked(generateCampaign).mockResolvedValue({
      objective: 'OUTCOME_LEADS',
      rationale: 'Test',
      campaign_name: 'Test Campaign',
      special_ad_category: 'NONE',
      ad_sets: [],
    });

    const result = await generateCampaignAction({
      problemBrief: 'We are quiet on Tuesdays',
      budgetAmount: 500,
      budgetType: 'DAILY',
      startDate: '2026-04-01',
      endDate: null,
    });

    expect(result.payload).toBeDefined();
    expect(result.payload?.campaign_name).toBe('Test Campaign');
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx vitest run tests/lib/campaigns/campaign-actions.test.ts
```

Expected: FAIL.

**Step 3: Create actions.ts**

Create `src/app/(app)/campaigns/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import { generateCampaign } from '@/lib/campaigns/generate';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import type { AiCampaignPayload, BudgetType, Campaign } from '@/types/campaigns';

interface GenerateInput {
  problemBrief: string;
  budgetAmount: number;
  budgetType: BudgetType;
  startDate: string;
  endDate: string | null;
}

export async function generateCampaignAction(
  input: GenerateInput
): Promise<{ payload?: AiCampaignPayload; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Check ad account is set up
  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('setup_complete, meta_account_id, currency, timezone')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!adAccount?.setup_complete) {
    return { error: 'Meta Ads account not connected. Please complete setup in Connections.' };
  }

  // Fetch venue info for context
  const { data: venue } = await supabase
    .from('accounts')
    .select('name, city')
    .eq('id', accountId)
    .single();

  try {
    const payload = await generateCampaign({
      problemBrief: input.problemBrief,
      venueName: venue?.name ?? 'our venue',
      venueLocation: venue?.city ?? 'UK',
      budgetAmount: input.budgetAmount,
      budgetType: input.budgetType,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    return { payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI generation failed';
    return { error: message };
  }
}

export async function saveCampaignDraft(
  payload: AiCampaignPayload,
  meta: { budgetAmount: number; budgetType: BudgetType; startDate: string; endDate: string | null; problemBrief: string }
): Promise<{ campaignId?: string; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Insert campaign
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert({
      account_id: accountId,
      name: payload.campaign_name,
      objective: payload.objective,
      problem_brief: meta.problemBrief,
      ai_rationale: payload.rationale,
      budget_type: meta.budgetType,
      budget_amount: meta.budgetAmount,
      start_date: meta.startDate,
      end_date: meta.endDate,
      special_ad_category: payload.special_ad_category,
      status: 'DRAFT',
    })
    .select('id')
    .single();

  if (campaignError || !campaign) {
    return { error: campaignError?.message ?? 'Failed to save campaign' };
  }

  // Insert ad sets and ads
  for (const adSetData of payload.ad_sets) {
    const { data: adSet, error: adSetError } = await supabase
      .from('ad_sets')
      .insert({
        campaign_id: campaign.id,
        name: adSetData.name,
        targeting: adSetData.targeting,
        placements: adSetData.placements,
        optimisation_goal: adSetData.optimisation_goal,
        bid_strategy: adSetData.bid_strategy,
        status: 'DRAFT',
      })
      .select('id')
      .single();

    if (adSetError || !adSet) continue;

    for (const adData of adSetData.ads) {
      await supabase.from('ads').insert({
        adset_id: adSet.id,
        name: adData.name,
        headline: adData.headline,
        primary_text: adData.primary_text,
        description: adData.description,
        cta: adData.cta,
        creative_brief: adData.creative_brief,
        status: 'DRAFT',
      });
    }
  }

  revalidatePath('/campaigns');
  return { campaignId: campaign.id };
}

export async function getCampaigns(): Promise<Campaign[]> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    metaCampaignId: row.meta_campaign_id,
    name: row.name,
    objective: row.objective,
    problemBrief: row.problem_brief,
    aiRationale: row.ai_rationale,
    budgetType: row.budget_type,
    budgetAmount: row.budget_amount,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    metaStatus: row.meta_status,
    specialAdCategory: row.special_ad_category,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
    createdAt: new Date(row.created_at),
  }));
}

export async function getCampaignWithTree(campaignId: string): Promise<Campaign | null> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select(`
      *,
      ad_sets (
        *,
        ads (*)
      )
    `)
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single();

  if (!campaign) return null;

  return {
    id: campaign.id,
    accountId: campaign.account_id,
    metaCampaignId: campaign.meta_campaign_id,
    name: campaign.name,
    objective: campaign.objective,
    problemBrief: campaign.problem_brief,
    aiRationale: campaign.ai_rationale,
    budgetType: campaign.budget_type,
    budgetAmount: campaign.budget_amount,
    startDate: campaign.start_date,
    endDate: campaign.end_date,
    status: campaign.status,
    metaStatus: campaign.meta_status,
    specialAdCategory: campaign.special_ad_category,
    lastSyncedAt: campaign.last_synced_at ? new Date(campaign.last_synced_at) : null,
    createdAt: new Date(campaign.created_at),
    adSets: (campaign.ad_sets ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      campaignId: s.campaign_id,
      metaAdsetId: s.meta_adset_id,
      name: s.name,
      targeting: s.targeting,
      placements: s.placements,
      budgetAmount: s.budget_amount,
      optimisationGoal: s.optimisation_goal,
      bidStrategy: s.bid_strategy,
      status: s.status,
      createdAt: new Date(s.created_at as string),
      ads: ((s.ads as Record<string, unknown>[]) ?? []).map((a) => ({
        id: a.id,
        adsetId: a.adset_id,
        metaAdId: a.meta_ad_id,
        metaCreativeId: a.meta_creative_id,
        name: a.name,
        headline: a.headline,
        primaryText: a.primary_text,
        description: a.description,
        cta: a.cta,
        mediaAssetId: a.media_asset_id,
        creativeBrief: a.creative_brief,
        previewUrl: a.preview_url,
        status: a.status,
        createdAt: new Date(a.created_at as string),
      })),
    })),
  };
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/lib/campaigns/campaign-actions.test.ts
```

Expected: PASS.

**Step 5: Type-check**

```bash
npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/app/\(app\)/campaigns/actions.ts tests/lib/campaigns/campaign-actions.test.ts
git commit -m "feat: add campaign server actions (generate, save, fetch)"
```

---

### Task 7: Campaign builder UI pages

**Files:**
- Create: `src/app/(app)/campaigns/page.tsx`
- Create: `src/app/(app)/campaigns/new/page.tsx`
- Create: `src/app/(app)/campaigns/[id]/page.tsx`
- Create: `src/features/campaigns/CampaignList.tsx`
- Create: `src/features/campaigns/CampaignBriefForm.tsx`
- Create: `src/features/campaigns/CampaignTree.tsx`
- Create: `src/features/campaigns/AdPreview.tsx`

**Step 1: Campaigns list page**

Create `src/app/(app)/campaigns/page.tsx`:

```tsx
import Link from 'next/link';

import { getCampaigns } from './actions';
import { CampaignList } from '@/features/campaigns/CampaignList';
import { getAdAccountSetupStatus } from '../connections/actions-ads';

export default async function CampaignsPage() {
  const [campaigns, adStatus] = await Promise.all([
    getCampaigns(),
    getAdAccountSetupStatus(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Paid media campaigns for Meta</p>
        </div>
        {adStatus.setupComplete && (
          <Link
            href="/campaigns/new"
            className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90"
          >
            New Campaign
          </Link>
        )}
      </div>

      {!adStatus.setupComplete && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">Meta Ads not connected</p>
          <p className="text-xs text-amber-700 mt-1">
            <Link href="/connections" className="underline">Complete setup in Connections</Link> to create campaigns.
          </p>
        </div>
      )}

      <CampaignList campaigns={campaigns} />
    </div>
  );
}
```

**Step 2: CampaignList component**

Create `src/features/campaigns/CampaignList.tsx`:

```tsx
import type { Campaign } from '@/types/campaigns';

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_SALES: 'Sales',
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-green-100 text-green-800',
  PAUSED: 'bg-amber-100 text-amber-800',
  ARCHIVED: 'bg-gray-100 text-gray-600',
};

interface Props {
  campaigns: Campaign[];
}

export function CampaignList({ campaigns }: Props) {
  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
        <p className="text-sm font-medium text-muted-foreground">No campaigns yet</p>
        <p className="text-xs text-muted-foreground mt-1">Create your first campaign to get started.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
            <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Objective</th>
            <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Budget</th>
            <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Dates</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium">
                <a href={`/campaigns/${campaign.id}`} className="hover:underline">
                  {campaign.name}
                </a>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {OBJECTIVE_LABELS[campaign.objective] ?? campaign.objective}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[campaign.status] ?? ''}`}>
                  {campaign.status}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                £{campaign.budgetAmount}/{campaign.budgetType === 'DAILY' ? 'day' : 'total'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {campaign.startDate}{campaign.endDate ? ` → ${campaign.endDate}` : ' (ongoing)'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 3: New campaign page with brief form**

Create `src/app/(app)/campaigns/new/page.tsx`:

```tsx
import { CampaignBriefForm } from '@/features/campaigns/CampaignBriefForm';

export default function NewCampaignPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Campaign</h1>
        <p className="text-sm text-muted-foreground">Describe the problem and AI will generate the campaign.</p>
      </div>
      <CampaignBriefForm />
    </div>
  );
}
```

**Step 4: CampaignBriefForm (client component)**

Create `src/features/campaigns/CampaignBriefForm.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { useToast } from '@/components/providers/toast-provider';
import { generateCampaignAction, saveCampaignDraft } from '@/app/(app)/campaigns/actions';
import type { AiCampaignPayload, BudgetType } from '@/types/campaigns';
import { CampaignTree } from './CampaignTree';

type Step = 'brief' | 'generating' | 'review';

export function CampaignBriefForm() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>('brief');
  const [generationStatus, setGenerationStatus] = useState('');
  const [payload, setPayload] = useState<AiCampaignPayload | null>(null);

  const [form, setForm] = useState({
    problemBrief: '',
    budgetAmount: 500,
    budgetType: 'DAILY' as BudgetType,
    startDate: '',
    endDate: '',
    budgetOptimisation: 'CBO' as 'CBO' | 'ABO',
  });

  const handleGenerate = () => {
    if (!form.problemBrief.trim() || !form.startDate) {
      toast.error('Please fill in the brief and start date');
      return;
    }

    startTransition(async () => {
      setStep('generating');
      setGenerationStatus('Identifying campaign objective…');

      // Simulate streaming progress
      setTimeout(() => setGenerationStatus('Building audience strategy…'), 1500);
      setTimeout(() => setGenerationStatus('Writing ad copy…'), 3000);

      const result = await generateCampaignAction({
        problemBrief: form.problemBrief,
        budgetAmount: form.budgetAmount,
        budgetType: form.budgetType,
        startDate: form.startDate,
        endDate: form.endDate || null,
      });

      if (result.error || !result.payload) {
        toast.error(result.error ?? 'Generation failed');
        setStep('brief');
        return;
      }

      setPayload(result.payload);
      setStep('review');
    });
  };

  const handleSave = () => {
    if (!payload) return;
    startTransition(async () => {
      const result = await saveCampaignDraft(payload, {
        budgetAmount: form.budgetAmount,
        budgetType: form.budgetType,
        startDate: form.startDate,
        endDate: form.endDate || null,
        problemBrief: form.problemBrief,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      router.push(`/campaigns/${result.campaignId}`);
    });
  };

  if (step === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-navy border-t-transparent" />
        <p className="text-sm text-muted-foreground">{generationStatus}</p>
      </div>
    );
  }

  if (step === 'review' && payload) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <p className="font-medium">AI Rationale</p>
          <p className="text-muted-foreground mt-1">{payload.rationale}</p>
        </div>
        <CampaignTree payload={payload} onChange={setPayload} />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep('brief')}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:opacity-60"
          >
            {isPending ? 'Saving…' : 'Save Draft'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="brief" className="text-sm font-medium">
          What problem are you trying to solve?
        </label>
        <textarea
          id="brief"
          rows={4}
          placeholder="e.g. We're dead on Tuesday nights and need to drive covers and awareness..."
          value={form.problemBrief}
          onChange={(e) => setForm((f) => ({ ...f, problemBrief: e.target.value }))}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-navy/40"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="budget" className="text-sm font-medium">Budget (£)</label>
          <input
            id="budget"
            type="number"
            min={1}
            value={form.budgetAmount}
            onChange={(e) => setForm((f) => ({ ...f, budgetAmount: Number(e.target.value) }))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/40"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Budget type</label>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['DAILY', 'LIFETIME'] as BudgetType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm((f) => ({ ...f, budgetType: type }))}
                className={`flex-1 py-2 text-sm font-medium transition ${
                  form.budgetType === type
                    ? 'bg-brand-navy text-white'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {type === 'DAILY' ? 'Daily' : 'Lifetime'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="start" className="text-sm font-medium">Start date</label>
          <input
            id="start"
            type="date"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/40"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="end" className="text-sm font-medium">End date <span className="text-muted-foreground">(optional)</span></label>
          <input
            id="end"
            type="date"
            value={form.endDate}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/40"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={isPending}
        className="w-full rounded-full bg-brand-navy px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:opacity-60"
      >
        Generate Campaign
      </button>
    </div>
  );
}
```

**Step 5: CampaignTree component**

Create `src/features/campaigns/CampaignTree.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

import type { AiCampaignPayload } from '@/types/campaigns';
import { AdPreview } from './AdPreview';

interface Props {
  payload: AiCampaignPayload;
  onChange: (updated: AiCampaignPayload) => void;
}

type Selection =
  | { type: 'campaign' }
  | { type: 'adset'; adsetIndex: number }
  | { type: 'ad'; adsetIndex: number; adIndex: number };

export function CampaignTree({ payload, onChange }: Props) {
  const [selected, setSelected] = useState<Selection>({ type: 'campaign' });
  const [expandedSets, setExpandedSets] = useState<Set<number>>(new Set([0]));

  const toggleSet = (i: number) => {
    setExpandedSets((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const updateAd = (adsetIndex: number, adIndex: number, field: string, value: string) => {
    const updated = { ...payload };
    updated.ad_sets = [...payload.ad_sets];
    updated.ad_sets[adsetIndex] = { ...updated.ad_sets[adsetIndex] };
    updated.ad_sets[adsetIndex].ads = [...updated.ad_sets[adsetIndex].ads];
    updated.ad_sets[adsetIndex].ads[adIndex] = {
      ...updated.ad_sets[adsetIndex].ads[adIndex],
      [field]: value,
    };
    onChange(updated);
  };

  const updateAdSet = (adsetIndex: number, field: string, value: string) => {
    const updated = { ...payload };
    updated.ad_sets = [...payload.ad_sets];
    updated.ad_sets[adsetIndex] = { ...updated.ad_sets[adsetIndex], [field]: value };
    onChange(updated);
  };

  const selectedAd =
    selected.type === 'ad'
      ? payload.ad_sets[selected.adsetIndex]?.ads[selected.adIndex]
      : null;

  return (
    <div className="grid grid-cols-[200px_1fr_1fr] gap-4 rounded-lg border border-border overflow-hidden min-h-[400px]">
      {/* Tree */}
      <div className="border-r border-border bg-muted/30 p-3 space-y-1 text-sm">
        <button
          type="button"
          onClick={() => setSelected({ type: 'campaign' })}
          className={`w-full rounded px-2 py-1.5 text-left font-medium transition ${selected.type === 'campaign' ? 'bg-brand-navy text-white' : 'hover:bg-muted'}`}
        >
          {payload.campaign_name}
        </button>

        {payload.ad_sets.map((adSet, si) => (
          <div key={si}>
            <button
              type="button"
              onClick={() => { toggleSet(si); setSelected({ type: 'adset', adsetIndex: si }); }}
              className={`flex w-full items-center gap-1 rounded px-2 py-1.5 text-left transition ${selected.type === 'adset' && selected.adsetIndex === si ? 'bg-brand-navy text-white' : 'hover:bg-muted'}`}
            >
              {expandedSets.has(si) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="truncate">{adSet.name}</span>
            </button>
            {expandedSets.has(si) && adSet.ads.map((ad, ai) => (
              <button
                key={ai}
                type="button"
                onClick={() => setSelected({ type: 'ad', adsetIndex: si, adIndex: ai })}
                className={`ml-4 w-[calc(100%-1rem)] rounded px-2 py-1 text-left text-xs transition ${selected.type === 'ad' && selected.adsetIndex === si && selected.adIndex === ai ? 'bg-brand-navy text-white' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {ad.name}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Detail editor */}
      <div className="p-4 space-y-4 text-sm overflow-y-auto">
        {selected.type === 'campaign' && (
          <div className="space-y-3">
            <p className="font-medium">Campaign</p>
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <input
                type="text"
                value={payload.campaign_name}
                onChange={(e) => onChange({ ...payload, campaign_name: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy/40"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Objective</label>
              <p className="mt-1 text-sm">{payload.objective}</p>
            </div>
          </div>
        )}

        {selected.type === 'adset' && (
          <div className="space-y-3">
            <p className="font-medium">Ad Set</p>
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <input
                type="text"
                value={payload.ad_sets[selected.adsetIndex].name}
                onChange={(e) => updateAdSet(selected.adsetIndex, 'name', e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy/40"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Audience</label>
              <p className="mt-1 text-xs text-muted-foreground">{payload.ad_sets[selected.adsetIndex].audience_description}</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Optimisation goal</label>
              <p className="mt-1 text-sm">{payload.ad_sets[selected.adsetIndex].optimisation_goal}</p>
            </div>
          </div>
        )}

        {selected.type === 'ad' && selectedAd && (
          <div className="space-y-3">
            <p className="font-medium">Ad</p>
            {(['headline', 'primary_text', 'description'] as const).map((field) => {
              const limits = { headline: 40, primary_text: 125, description: 25 };
              const val = selectedAd[field];
              return (
                <div key={field}>
                  <label className="text-xs text-muted-foreground capitalize">{field.replace('_', ' ')} ({val.length}/{limits[field]})</label>
                  <textarea
                    rows={field === 'primary_text' ? 3 : 1}
                    value={val}
                    maxLength={limits[field]}
                    onChange={(e) => updateAd(selected.adsetIndex, selected.adIndex, field, e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy/40 resize-none"
                  />
                </div>
              );
            })}
            <div>
              <label className="text-xs text-muted-foreground">Creative brief</label>
              <p className="mt-1 text-xs text-muted-foreground italic">{selectedAd.creative_brief}</p>
              <button type="button" className="mt-2 text-xs text-brand-navy underline">Pick creative from library</button>
            </div>
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="border-l border-border bg-muted/10 p-4">
        {selected.type === 'ad' && selectedAd ? (
          <AdPreview
            headline={selectedAd.headline}
            primaryText={selectedAd.primary_text}
            cta={selectedAd.cta}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Select an ad to preview
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 6: AdPreview component**

Create `src/features/campaigns/AdPreview.tsx`:

```tsx
interface Props {
  headline: string;
  primaryText: string;
  cta: string;
  imageUrl?: string;
}

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: 'Learn More',
  SIGN_UP: 'Sign Up',
  BOOK_NOW: 'Book Now',
  GET_QUOTE: 'Get Quote',
  CONTACT_US: 'Contact Us',
  SUBSCRIBE: 'Subscribe',
};

export function AdPreview({ headline, primaryText, cta, imageUrl }: Props) {
  return (
    <div className="rounded-lg border border-border bg-white shadow-sm overflow-hidden max-w-[280px] text-xs font-sans">
      {/* Header */}
      <div className="flex items-center gap-2 p-2.5 border-b border-border">
        <div className="h-8 w-8 rounded-full bg-brand-navy/20 flex items-center justify-center text-xs font-bold text-brand-navy">
          C
        </div>
        <div>
          <p className="font-semibold text-xs">CheersAI Demo</p>
          <p className="text-[10px] text-muted-foreground">Sponsored</p>
        </div>
      </div>

      {/* Primary text */}
      <div className="p-2.5">
        <p className="text-xs leading-relaxed text-gray-800 line-clamp-3">{primaryText}</p>
      </div>

      {/* Image placeholder */}
      <div className="aspect-square bg-gradient-to-br from-brand-navy/10 to-brand-navy/30 flex items-center justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt="Ad creative" className="w-full h-full object-cover" />
        ) : (
          <p className="text-xs text-muted-foreground">Creative</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between p-2.5 border-t border-border">
        <p className="font-semibold text-xs truncate max-w-[140px]">{headline}</p>
        <button
          type="button"
          className="rounded px-2 py-1 bg-muted text-xs font-semibold text-foreground shrink-0"
        >
          {CTA_LABELS[cta] ?? cta}
        </button>
      </div>
    </div>
  );
}
```

**Step 7: Campaign detail page (placeholder for Phase 3)**

Create `src/app/(app)/campaigns/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

import { getCampaignWithTree } from '../actions';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignDetailPage({ params }: Props) {
  const { id } = await params;
  const campaign = await getCampaignWithTree(id);
  if (!campaign) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">{campaign.objective} · {campaign.status}</p>
        </div>
        {campaign.status === 'DRAFT' && (
          <button
            type="button"
            className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90"
          >
            Publish to Meta
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border p-4 text-sm space-y-2">
        <p className="font-medium">Campaign brief</p>
        <p className="text-muted-foreground">{campaign.problemBrief}</p>
        {campaign.aiRationale && (
          <>
            <p className="font-medium mt-3">AI rationale</p>
            <p className="text-muted-foreground">{campaign.aiRationale}</p>
          </>
        )}
      </div>

      <div className="space-y-3">
        <p className="font-medium text-sm">Ad Sets ({campaign.adSets?.length ?? 0})</p>
        {campaign.adSets?.map((adSet) => (
          <div key={adSet.id} className="rounded-lg border border-border p-4 text-sm space-y-2">
            <p className="font-medium">{adSet.name}</p>
            <p className="text-xs text-muted-foreground">Goal: {adSet.optimisationGoal}</p>
            <div className="space-y-1 mt-2">
              {adSet.ads?.map((ad) => (
                <div key={ad.id} className="rounded border border-border/50 bg-muted/30 px-3 py-2">
                  <p className="font-medium text-xs">{ad.headline}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ad.primaryText}</p>
                  {!ad.mediaAssetId && (
                    <p className="text-xs text-amber-600 mt-1">⚠ No creative selected</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 8: Type-check and lint**

```bash
npx tsc --noEmit && npm run lint
```

Fix any errors before continuing.

**Step 9: Commit**

```bash
git add src/app/\(app\)/campaigns/ src/features/campaigns/
git commit -m "feat: add campaign builder UI — list, brief form, tree editor, ad preview"
```

---

## Phase 3: Meta API Publishing, Sync, Campaign Detail

### Task 8: Meta Marketing API client

**Files:**
- Create: `src/lib/meta/marketing.ts`
- Create: `tests/lib/meta/marketing.test.ts`

**Step 1: Write failing tests**

Create `tests/lib/meta/marketing.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/meta/graph', () => ({
  getMetaGraphApiBase: vi.fn().mockReturnValue('https://graph.facebook.com/v24.0'),
}));

import { createMetaCampaign, createMetaAdSet } from '@/lib/meta/marketing';

describe('createMetaCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should POST to campaigns endpoint and return id', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'campaign_123' }),
    } as Response);

    const result = await createMetaCampaign({
      accessToken: 'test-token',
      adAccountId: 'act_123',
      name: 'Test Campaign',
      objective: 'OUTCOME_LEADS',
      specialAdCategory: 'NONE',
      status: 'PAUSED',
    });

    expect(result.id).toBe('campaign_123');
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/campaigns'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should throw a MetaApiError on failure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token', code: 190 } }),
    } as Response);

    await expect(
      createMetaCampaign({
        accessToken: 'bad-token',
        adAccountId: 'act_123',
        name: 'Test',
        objective: 'OUTCOME_LEADS',
        specialAdCategory: 'NONE',
        status: 'PAUSED',
      })
    ).rejects.toThrow('Invalid token');
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx vitest run tests/lib/meta/marketing.test.ts
```

Expected: FAIL.

**Step 3: Implement marketing.ts**

Create `src/lib/meta/marketing.ts`:

```typescript
import { getMetaGraphApiBase } from './graph';

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly subcode?: number
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

async function metaPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = `${getMetaGraphApiBase()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: accessToken }),
  });

  const data = await res.json() as T & { error?: { message: string; code: number; error_subcode?: number } };

  if (!res.ok || (data as { error?: unknown }).error) {
    const err = (data as { error?: { message: string; code: number; error_subcode?: number } }).error;
    throw new MetaApiError(
      err?.message ?? 'Meta API error',
      err?.code ?? res.status,
      err?.error_subcode
    );
  }

  return data;
}

async function metaGet<T>(path: string, accessToken: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${getMetaGraphApiBase()}${path}`);
  url.searchParams.set('access_token', accessToken);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString());
  const data = await res.json() as T & { error?: { message: string; code: number } };

  if (!res.ok || (data as { error?: unknown }).error) {
    const err = (data as { error?: { message: string; code: number } }).error;
    throw new MetaApiError(err?.message ?? 'Meta API error', err?.code ?? res.status);
  }

  return data;
}

// Campaign
export interface CreateCampaignParams {
  accessToken: string;
  adAccountId: string;
  name: string;
  objective: string;
  specialAdCategory: string;
  status: 'ACTIVE' | 'PAUSED';
}

export async function createMetaCampaign(params: CreateCampaignParams): Promise<{ id: string }> {
  return metaPost<{ id: string }>(
    `/${params.adAccountId}/campaigns`,
    params.accessToken,
    {
      name: params.name,
      objective: params.objective,
      special_ad_categories: params.specialAdCategory === 'NONE' ? [] : [params.specialAdCategory],
      status: params.status,
    }
  );
}

export async function pauseMetaObject(
  objectId: string,
  accessToken: string
): Promise<void> {
  await metaPost(`/${objectId}`, accessToken, { status: 'PAUSED' });
}

// Ad Set
export interface CreateAdSetParams {
  accessToken: string;
  adAccountId: string;
  campaignId: string;
  name: string;
  targeting: Record<string, unknown>;
  optimisationGoal: string;
  bidStrategy: string;
  budgetAmount?: number;
  dailyBudget?: number;
  lifetimeBudget?: number;
  startTime: string;
  endTime?: string;
  status: 'ACTIVE' | 'PAUSED';
}

export async function createMetaAdSet(params: CreateAdSetParams): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    name: params.name,
    campaign_id: params.campaignId,
    targeting: params.targeting,
    optimization_goal: params.optimisationGoal,
    bid_strategy: params.bidStrategy,
    start_time: params.startTime,
    status: params.status,
  };

  if (params.dailyBudget) body.daily_budget = Math.round(params.dailyBudget * 100); // Meta uses cents
  if (params.lifetimeBudget) body.lifetime_budget = Math.round(params.lifetimeBudget * 100);
  if (params.endTime) body.end_time = params.endTime;

  return metaPost<{ id: string }>(`/${params.adAccountId}/adsets`, params.accessToken, body);
}

// Creative (image upload)
export async function uploadMetaImage(
  adAccountId: string,
  accessToken: string,
  imageUrl: string
): Promise<{ hash: string }> {
  // Fetch the image and convert to base64
  const imgRes = await fetch(imageUrl);
  const buffer = await imgRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  const data = await metaPost<{ images: Record<string, { hash: string }> }>(
    `/${adAccountId}/adimages`,
    accessToken,
    { bytes: base64 }
  );

  const [first] = Object.values(data.images);
  if (!first) throw new MetaApiError('No image hash returned', 0);
  return { hash: first.hash };
}

export async function createMetaAdCreative(params: {
  accessToken: string;
  adAccountId: string;
  name: string;
  pageId: string;
  imageHash: string;
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  linkUrl: string;
}): Promise<{ id: string }> {
  return metaPost<{ id: string }>(`/${params.adAccountId}/adcreatives`, params.accessToken, {
    name: params.name,
    object_story_spec: {
      page_id: params.pageId,
      link_data: {
        image_hash: params.imageHash,
        link: params.linkUrl,
        message: params.primaryText,
        name: params.headline,
        description: params.description,
        call_to_action: { type: params.cta },
      },
    },
  });
}

export async function createMetaAd(params: {
  accessToken: string;
  adAccountId: string;
  adsetId: string;
  name: string;
  creativeId: string;
  status: 'ACTIVE' | 'PAUSED';
}): Promise<{ id: string }> {
  return metaPost<{ id: string }>(`/${params.adAccountId}/ads`, params.accessToken, {
    name: params.name,
    adset_id: params.adsetId,
    creative: { creative_id: params.creativeId },
    status: params.status,
  });
}

// Insights sync
export interface CampaignInsights {
  spend: number;
  impressions: number;
  reach: number;
  status: string;
}

export async function fetchCampaignInsights(
  campaignId: string,
  accessToken: string
): Promise<CampaignInsights> {
  const data = await metaGet<{
    data?: Array<{ spend: string; impressions: string; reach: string }>;
    status?: string;
  }>(
    `/${campaignId}/insights`,
    accessToken,
    { fields: 'spend,impressions,reach', date_preset: 'last_30d' }
  );

  const row = data.data?.[0];
  return {
    spend: parseFloat(row?.spend ?? '0'),
    impressions: parseInt(row?.impressions ?? '0', 10),
    reach: parseInt(row?.reach ?? '0', 10),
    status: data.status ?? 'UNKNOWN',
  };
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/lib/meta/marketing.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/meta/marketing.ts tests/lib/meta/marketing.test.ts
git commit -m "feat: add Meta Marketing API client with campaign, adset, creative, and ad creation"
```

---

### Task 9: Publish server action

**Files:**
- Create: `src/app/(app)/campaigns/[id]/actions.ts`
- Create: `tests/lib/campaigns/publish.test.ts`

**Step 1: Write failing tests**

Create `tests/lib/campaigns/publish.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: vi.fn().mockResolvedValue({ accountId: 'account-123' }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));
vi.mock('@/lib/meta/marketing', () => ({
  createMetaCampaign: vi.fn(),
  createMetaAdSet: vi.fn(),
  uploadMetaImage: vi.fn(),
  createMetaAdCreative: vi.fn(),
  createMetaAd: vi.fn(),
  pauseMetaObject: vi.fn(),
  MetaApiError: class MetaApiError extends Error {},
}));

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import * as marketing from '@/lib/meta/marketing';
import { publishCampaign } from '@/app/(app)/campaigns/[id]/actions';

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServiceSupabaseClient>);
});

describe('publishCampaign', () => {
  it('should return error if campaign not found', async () => {
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const result = await publishCampaign('campaign-123');
    expect(result.error).toBeDefined();
  });

  it('should call Meta API and update campaign on success', async () => {
    // Campaign
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        id: 'campaign-123',
        name: 'Test',
        objective: 'OUTCOME_LEADS',
        special_ad_category: 'NONE',
        budget_type: 'DAILY',
        budget_amount: 10,
        start_date: '2026-04-01',
        end_date: null,
        account_id: 'account-123',
      },
    });
    // Ad account
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        access_token: 'token',
        meta_account_id: 'act_123',
      },
    });
    // Ad sets query
    mockSupabase.single.mockResolvedValueOnce({ data: [] });

    vi.mocked(marketing.createMetaCampaign).mockResolvedValue({ id: 'meta_camp_123' });
    mockSupabase.update.mockReturnThis();
    mockSupabase.eq.mockResolvedValue({ data: null, error: null });

    const result = await publishCampaign('campaign-123');
    expect(marketing.createMetaCampaign).toHaveBeenCalled();
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx vitest run tests/lib/campaigns/publish.test.ts
```

**Step 3: Create the publish action**

Create `src/app/(app)/campaigns/[id]/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';

import { requireAuthContext } from '@/lib/auth/server';
import {
  createMetaAd,
  createMetaAdCreative,
  createMetaAdSet,
  createMetaCampaign,
  MetaApiError,
  pauseMetaObject,
  uploadMetaImage,
} from '@/lib/meta/marketing';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

export async function publishCampaign(
  campaignId: string
): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Fetch campaign
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single();

  if (campaignError || !campaign) {
    return { error: 'Campaign not found.' };
  }

  // Fetch ad account
  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('access_token, meta_account_id')
    .eq('account_id', accountId)
    .single();

  if (!adAccount?.access_token) {
    return { error: 'Meta Ads not connected.' };
  }

  // Check token expiry
  const { data: adAccountFull } = await supabase
    .from('meta_ad_accounts')
    .select('token_expires_at')
    .eq('account_id', accountId)
    .single();

  if (adAccountFull?.token_expires_at && new Date(adAccountFull.token_expires_at) < new Date()) {
    return { error: 'Meta Ads token has expired. Please reconnect in Connections.' };
  }

  // Fetch facebook page id for creatives
  const { data: fbConnection } = await supabase
    .from('social_connections')
    .select('metadata')
    .eq('account_id', accountId)
    .eq('provider', 'facebook')
    .single();

  const pageId = (fbConnection?.metadata as Record<string, unknown>)?.pageId as string | undefined;
  if (!pageId) {
    return { error: 'Facebook Page not connected. Please connect in Connections.' };
  }

  const createdMetaObjects: Array<{ id: string }> = [];

  try {
    // 1. Create campaign (initially paused so it doesn't spend immediately)
    const metaCampaign = await createMetaCampaign({
      accessToken: adAccount.access_token,
      adAccountId: adAccount.meta_account_id,
      name: campaign.name,
      objective: campaign.objective,
      specialAdCategory: campaign.special_ad_category,
      status: 'PAUSED',
    });

    createdMetaObjects.push({ id: metaCampaign.id });

    await supabase
      .from('campaigns')
      .update({ meta_campaign_id: metaCampaign.id, status: 'PAUSED' })
      .eq('id', campaignId);

    // 2. Fetch ad sets
    const { data: adSets } = await supabase
      .from('ad_sets')
      .select(`*, ads(*)`)
      .eq('campaign_id', campaignId);

    const startTime = new Date(campaign.start_date + 'T00:00:00Z').toISOString();
    const endTime = campaign.end_date
      ? new Date(campaign.end_date + 'T23:59:59Z').toISOString()
      : undefined;

    for (const adSet of adSets ?? []) {
      // 3. Create ad set
      const metaAdSet = await createMetaAdSet({
        accessToken: adAccount.access_token,
        adAccountId: adAccount.meta_account_id,
        campaignId: metaCampaign.id,
        name: adSet.name,
        targeting: adSet.targeting,
        optimisationGoal: adSet.optimisation_goal,
        bidStrategy: adSet.bid_strategy,
        dailyBudget: campaign.budget_type === 'DAILY' ? campaign.budget_amount : undefined,
        lifetimeBudget: campaign.budget_type === 'LIFETIME' ? campaign.budget_amount : undefined,
        startTime,
        endTime,
        status: 'PAUSED',
      });

      createdMetaObjects.push({ id: metaAdSet.id });

      await supabase
        .from('ad_sets')
        .update({ meta_adset_id: metaAdSet.id, status: 'PAUSED' })
        .eq('id', adSet.id);

      for (const ad of adSet.ads ?? []) {
        // 4. Upload creative if media asset exists
        let imageHash: string | undefined;

        if (ad.media_asset_id) {
          const { data: asset } = await supabase
            .from('media_assets')
            .select('url')
            .eq('id', ad.media_asset_id)
            .single();

          if (asset?.url) {
            const uploaded = await uploadMetaImage(
              adAccount.meta_account_id,
              adAccount.access_token,
              asset.url
            );
            imageHash = uploaded.hash;
          }
        }

        if (!imageHash) {
          // Skip ads without creatives
          continue;
        }

        // 5. Create ad creative
        const creative = await createMetaAdCreative({
          accessToken: adAccount.access_token,
          adAccountId: adAccount.meta_account_id,
          name: `${ad.name} Creative`,
          pageId,
          imageHash,
          headline: ad.headline,
          primaryText: ad.primary_text,
          description: ad.description,
          cta: ad.cta,
          linkUrl: `https://www.facebook.com/${pageId}`,
        });

        await supabase
          .from('ads')
          .update({ meta_creative_id: creative.id })
          .eq('id', ad.id);

        // 6. Create ad
        const metaAd = await createMetaAd({
          accessToken: adAccount.access_token,
          adAccountId: adAccount.meta_account_id,
          adsetId: metaAdSet.id,
          name: ad.name,
          creativeId: creative.id,
          status: 'ACTIVE',
        });

        await supabase
          .from('ads')
          .update({ meta_ad_id: metaAd.id, status: 'ACTIVE' })
          .eq('id', ad.id);
      }
    }

    // Activate campaign
    await supabase
      .from('campaigns')
      .update({ status: 'ACTIVE', meta_status: 'ACTIVE' })
      .eq('id', campaignId);

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath('/campaigns');
    return { success: true };
  } catch (err) {
    // Rollback: pause all created Meta objects
    for (const obj of createdMetaObjects) {
      try {
        await pauseMetaObject(obj.id, adAccount.access_token);
      } catch {
        // Best-effort rollback
      }
    }

    const message =
      err instanceof MetaApiError
        ? `Meta API error: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Publish failed';

    await supabase
      .from('campaigns')
      .update({ status: 'DRAFT' })
      .eq('id', campaignId);

    return { error: message };
  }
}

export async function pauseCampaign(
  campaignId: string
): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('meta_campaign_id, account_id')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .single();

  if (!campaign?.meta_campaign_id) return { error: 'Campaign not found or not published.' };

  const { data: adAccount } = await supabase
    .from('meta_ad_accounts')
    .select('access_token')
    .eq('account_id', accountId)
    .single();

  if (!adAccount?.access_token) return { error: 'Meta Ads not connected.' };

  try {
    await pauseMetaObject(campaign.meta_campaign_id, adAccount.access_token);
    await supabase.from('campaigns').update({ status: 'PAUSED' }).eq('id', campaignId);
    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to pause' };
  }
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/lib/campaigns/publish.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/\(app\)/campaigns/\[id\]/actions.ts tests/lib/campaigns/publish.test.ts
git commit -m "feat: add campaign publish action with Meta API sequencing and rollback"
```

---

### Task 10: Publish button on campaign detail

**Files:**
- Modify: `src/app/(app)/campaigns/[id]/page.tsx`

Open the campaign detail page. Replace the static `Publish to Meta` button with a client component that calls `publishCampaign`:

**Step 1: Create publish button component**

Create `src/features/campaigns/PublishButton.tsx`:

```tsx
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { useToast } from '@/components/providers/toast-provider';
import { publishCampaign, pauseCampaign } from '@/app/(app)/campaigns/[id]/actions';

interface Props {
  campaignId: string;
  status: string;
}

export function PublishButton({ campaignId, status }: Props) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const handlePublish = () => {
    startTransition(async () => {
      const result = await publishCampaign(campaignId);
      if (result.error) {
        toast.error('Publish failed', { description: result.error });
      } else {
        toast.success('Campaign published to Meta');
        router.refresh();
      }
    });
  };

  const handlePause = () => {
    startTransition(async () => {
      const result = await pauseCampaign(campaignId);
      if (result.error) {
        toast.error('Pause failed', { description: result.error });
      } else {
        toast.success('Campaign paused');
        router.refresh();
      }
    });
  };

  if (status === 'DRAFT') {
    return (
      <button
        type="button"
        onClick={handlePublish}
        disabled={isPending}
        className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:opacity-60"
      >
        {isPending ? 'Publishing…' : 'Publish to Meta'}
      </button>
    );
  }

  if (status === 'ACTIVE') {
    return (
      <button
        type="button"
        onClick={handlePause}
        disabled={isPending}
        className="rounded-full border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
      >
        {isPending ? 'Pausing…' : 'Pause Campaign'}
      </button>
    );
  }

  return null;
}
```

**Step 2: Update campaign detail page to use PublishButton**

In `src/app/(app)/campaigns/[id]/page.tsx`, replace the static button with:

```tsx
import { PublishButton } from '@/features/campaigns/PublishButton';

// In JSX, replace the button with:
<PublishButton campaignId={campaign.id} status={campaign.status} />
```

**Step 3: Commit**

```bash
git add src/features/campaigns/PublishButton.tsx src/app/\(app\)/campaigns/\[id\]/page.tsx
git commit -m "feat: wire up publish and pause buttons on campaign detail"
```

---

### Task 11: Daily status sync cron

**Files:**
- Create: `src/app/api/cron/sync-meta-campaigns/route.ts`

**Step 1: Create the cron route**

```typescript
import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/env';
import { fetchCampaignInsights } from '@/lib/meta/marketing';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${env.server.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();

  // Fetch all active/paused campaigns that have been published
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, meta_campaign_id, account_id')
    .not('meta_campaign_id', 'is', null)
    .in('status', ['ACTIVE', 'PAUSED']);

  if (!campaigns?.length) {
    return NextResponse.json({ synced: 0 });
  }

  let synced = 0;

  for (const campaign of campaigns) {
    try {
      const { data: adAccount } = await supabase
        .from('meta_ad_accounts')
        .select('access_token, token_expires_at')
        .eq('account_id', campaign.account_id)
        .single();

      if (!adAccount?.access_token) continue;

      // Skip if token expired
      if (adAccount.token_expires_at && new Date(adAccount.token_expires_at) < new Date()) continue;

      const insights = await fetchCampaignInsights(campaign.meta_campaign_id!, adAccount.access_token);

      await supabase
        .from('campaigns')
        .update({
          meta_status: insights.status,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      synced++;
    } catch (err) {
      console.error(`[sync-meta-campaigns] Failed for campaign ${campaign.id}:`, err);
    }
  }

  return NextResponse.json({ synced });
}
```

**Step 2: Add cron to vercel.json (if it exists, otherwise create)**

Check if `vercel.json` exists:

```bash
cat vercel.json 2>/dev/null || echo "not found"
```

If it exists, add to the `crons` array:
```json
{
  "path": "/api/cron/sync-meta-campaigns",
  "schedule": "0 6 * * *"
}
```

If it doesn't exist, create `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/sync-meta-campaigns",
      "schedule": "0 6 * * *"
    }
  ]
}
```

**Step 3: Commit**

```bash
git add src/app/api/cron/sync-meta-campaigns/route.ts vercel.json
git commit -m "feat: add daily Meta campaign status sync cron"
```

---

### Task 12: Final verification

**Step 1: Full CI pipeline**

```bash
npm run ci:verify
```

Expected: all four steps pass — lint, typecheck, test, build.

**Step 2: Fix any remaining issues**

Address lint warnings, type errors, or test failures before continuing.

**Step 3: Smoke test locally**

```bash
npm run dev
```

Verify:
1. `/campaigns` route loads
2. Campaigns nav item appears in sidebar
3. `/connections` shows Meta Ads setup card
4. `/campaigns/new` loads the brief form

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification for meta campaigns feature"
```

---

## Phase Summary

| Phase | Tasks | Key Output |
|-------|-------|------------|
| 1 | 1–4 | DB schema, types, OAuth extension, Ad Account setup UI |
| 2 | 5–7 | AI generation, campaign brief form, tree editor, ad preview |
| 3 | 8–12 | Meta API client, publish action, publish button, sync cron |

Each phase ends in a deployable state. Phases must be executed in order.
