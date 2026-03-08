# GBP Reviews Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Reviews section that fetches Google Business Profile reviews on a schedule, lets users generate AI-drafted replies per review, edit them, and post them back to Google.

**Architecture:** Reviews are synced hourly (+ on-demand) from the Google My Business v4 API and stored in a new `gbp_reviews` table. A new `/reviews` route displays them with per-review AI draft generation via `gpt-4o`. Posting replies calls the Google My Business reply API.

**Tech Stack:** Next.js App Router, Supabase (service-role client for cron, auth client for user actions), OpenAI (`gpt-4o` via existing `getOpenAIClient()`), Google My Business API v4, Vercel Cron, Lucide icons, Tailwind CSS.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260308170000_add_gbp_reviews.sql`

**Step 1: Write the migration**

```sql
create table if not exists gbp_reviews (
  id                uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references accounts(id) on delete cascade,
  google_review_id  text not null,
  reviewer_name     text not null default '',
  star_rating       integer not null check (star_rating between 1 and 5),
  comment           text,
  create_time       timestamptz not null,
  update_time       timestamptz not null,
  reply_comment     text,
  reply_update_time timestamptz,
  ai_draft          text,
  status            text not null default 'pending' check (status in ('pending', 'draft_ready', 'replied')),
  synced_at         timestamptz not null default now(),
  constraint gbp_reviews_business_review_unique unique (business_profile_id, google_review_id)
);

alter table gbp_reviews enable row level security;

create policy "Users can read own reviews"
  on gbp_reviews for select
  using (business_profile_id = auth.uid());

create policy "Users can update own reviews"
  on gbp_reviews for update
  using (business_profile_id = auth.uid());
```

**Step 2: Apply migration**

```bash
npx supabase db push
```

Expected: Migration applied with no errors.

**Step 3: Commit**

```bash
git add supabase/migrations/20260308170000_add_gbp_reviews.sql
git commit -m "feat: add gbp_reviews table with RLS"
```

---

### Task 2: TypeScript types

**Files:**
- Create: `src/types/reviews.ts`

**Step 1: Write the types**

```typescript
export type ReviewStatus = 'pending' | 'draft_ready' | 'replied';

export interface GbpReview {
  id: string;
  businessProfileId: string;
  googleReviewId: string;
  reviewerName: string;
  starRating: number;
  comment: string | null;
  createTime: string;
  updateTime: string;
  replyComment: string | null;
  replyUpdateTime: string | null;
  aiDraft: string | null;
  status: ReviewStatus;
  syncedAt: string;
}

// Shape returned by Google My Business API v4
export interface GmbApiReview {
  name: string;
  reviewId: string;
  reviewer: { displayName: string; isAnonymous?: boolean };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string };
}

export interface GmbReviewsResponse {
  reviews?: GmbApiReview[];
  nextPageToken?: string;
  totalReviewCount?: number;
}
```

**Step 2: Commit**

```bash
git add src/types/reviews.ts
git commit -m "feat: add GbpReview and GmbApiReview TypeScript types"
```

---

### Task 3: GBP reviews fetcher library

**Files:**
- Create: `src/lib/gbp/reviews.ts`

**Step 1: Write failing test**

Create `src/lib/gbp/reviews.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { starRatingToNumber, buildUpsertRow } from './reviews';

describe('starRatingToNumber', () => {
  it('should convert string ratings to numbers', () => {
    expect(starRatingToNumber('ONE')).toBe(1);
    expect(starRatingToNumber('THREE')).toBe(3);
    expect(starRatingToNumber('FIVE')).toBe(5);
  });

  it('should return 0 for unknown values', () => {
    expect(starRatingToNumber('UNKNOWN')).toBe(0);
  });
});

describe('buildUpsertRow', () => {
  it('should map a GmbApiReview to a DB row', () => {
    const review = {
      name: 'accounts/123/locations/456/reviews/abc',
      reviewId: 'abc',
      reviewer: { displayName: 'Jane Doe' },
      starRating: 'FOUR' as const,
      comment: 'Great pub!',
      createTime: '2026-03-01T10:00:00Z',
      updateTime: '2026-03-01T10:00:00Z',
    };
    const row = buildUpsertRow('profile-id', review);
    expect(row.google_review_id).toBe('abc');
    expect(row.reviewer_name).toBe('Jane Doe');
    expect(row.star_rating).toBe(4);
    expect(row.comment).toBe('Great pub!');
    expect(row.status).toBe('pending');
    expect(row.business_profile_id).toBe('profile-id');
  });

  it('should set status to replied when review has a reply', () => {
    const review = {
      name: 'accounts/123/locations/456/reviews/abc',
      reviewId: 'abc',
      reviewer: { displayName: 'Jane Doe' },
      starRating: 'FIVE' as const,
      createTime: '2026-03-01T10:00:00Z',
      updateTime: '2026-03-01T10:00:00Z',
      reviewReply: { comment: 'Thank you!', updateTime: '2026-03-02T10:00:00Z' },
    };
    const row = buildUpsertRow('profile-id', review);
    expect(row.status).toBe('replied');
    expect(row.reply_comment).toBe('Thank you!');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/gbp/reviews.test.ts
```

Expected: FAIL — `reviews.ts` does not exist.

**Step 3: Write the implementation**

Create `src/lib/gbp/reviews.ts`:

```typescript
import type { GmbApiReview, GmbReviewsResponse } from '@/types/reviews';

const GMB_BASE = 'https://mybusiness.googleapis.com/v4';

const STAR_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

export function starRatingToNumber(rating: string): number {
  return STAR_MAP[rating] ?? 0;
}

export function buildUpsertRow(businessProfileId: string, review: GmbApiReview) {
  const hasReply = !!review.reviewReply;
  return {
    business_profile_id: businessProfileId,
    google_review_id: review.reviewId,
    reviewer_name: review.reviewer.displayName,
    star_rating: starRatingToNumber(review.starRating),
    comment: review.comment ?? null,
    create_time: review.createTime,
    update_time: review.updateTime,
    reply_comment: review.reviewReply?.comment ?? null,
    reply_update_time: review.reviewReply?.updateTime ?? null,
    status: hasReply ? 'replied' : 'pending',
    synced_at: new Date().toISOString(),
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_MY_BUSINESS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_MY_BUSINESS_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(`Google token refresh failed: ${json.error ?? 'unknown'}`);
  }
  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  return { accessToken: json.access_token, expiresAt };
}

export async function fetchGbpReviews(
  locationId: string,
  accessToken: string,
): Promise<GmbApiReview[]> {
  const reviews: GmbApiReview[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GMB_BASE}/${locationId}/reviews`);
    url.searchParams.set('pageSize', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GBP reviews fetch failed (${response.status}): ${text}`);
    }

    const json = await response.json() as GmbReviewsResponse;
    if (json.reviews) reviews.push(...json.reviews);
    pageToken = json.nextPageToken;
  } while (pageToken);

  return reviews;
}

export async function postGbpReply(
  reviewName: string,
  comment: string,
  accessToken: string,
): Promise<void> {
  // reviewName is the full resource name, e.g. accounts/123/locations/456/reviews/abc
  const response = await fetch(
    `${GMB_BASE}/${reviewName}/reply`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GBP reply failed (${response.status}): ${text}`);
  }
}
```

**Step 4: Run tests**

```bash
npx vitest run src/lib/gbp/reviews.test.ts
```

Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/lib/gbp/reviews.ts src/lib/gbp/reviews.test.ts
git commit -m "feat: add GBP reviews fetcher library with upsert helpers"
```

---

### Task 4: Server actions

**Files:**
- Create: `src/app/(app)/reviews/actions.ts`

**Step 1: Write the file**

```typescript
'use server';

import { revalidatePath } from 'next/cache';

import { getOpenAIClient } from '@/lib/ai/client';
import {
  buildUpsertRow,
  fetchGbpReviews,
  postGbpReply,
  refreshGoogleAccessToken,
} from '@/lib/gbp/reviews';
import { requireAuthContext } from '@/lib/auth/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

async function getActiveGbpConnection(accountId: string) {
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from('social_connections')
    .select('access_token, refresh_token, expires_at, metadata')
    .eq('account_id', accountId)
    .eq('provider', 'gbp')
    .maybeSingle<{
      access_token: string | null;
      refresh_token: string | null;
      expires_at: string | null;
      metadata: Record<string, unknown> | null;
    }>();
  return data;
}

async function resolveAccessToken(accountId: string): Promise<{ token: string; locationId: string }> {
  const supabase = createServiceSupabaseClient();
  const conn = await getActiveGbpConnection(accountId);

  if (!conn?.access_token || !conn.refresh_token) {
    throw new Error('No active Google Business Profile connection.');
  }

  const locationId = conn.metadata?.locationId as string | undefined;
  if (!locationId) {
    throw new Error('Google Business Profile location ID not configured.');
  }

  // Refresh token if expired or within 5 minutes of expiry
  const isExpired =
    conn.expires_at && new Date(conn.expires_at) < new Date(Date.now() + 5 * 60 * 1000);

  if (isExpired) {
    const { accessToken, expiresAt } = await refreshGoogleAccessToken(conn.refresh_token);
    await supabase
      .from('social_connections')
      .update({ access_token: accessToken, expires_at: expiresAt })
      .eq('account_id', accountId)
      .eq('provider', 'gbp');
    return { token: accessToken, locationId };
  }

  return { token: conn.access_token, locationId };
}

export async function syncGbpReviews(): Promise<{ success?: boolean; synced?: number; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  try {
    const { token, locationId } = await resolveAccessToken(accountId);
    const reviews = await fetchGbpReviews(locationId, token);

    if (reviews.length === 0) {
      return { success: true, synced: 0 };
    }

    const rows = reviews.map((r) => buildUpsertRow(accountId, r));

    const { error } = await supabase
      .from('gbp_reviews')
      .upsert(rows, {
        onConflict: 'business_profile_id,google_review_id',
        ignoreDuplicates: false,
      });

    if (error) throw error;

    revalidatePath('/reviews');
    return { success: true, synced: rows.length };
  } catch (err) {
    console.error('[syncGbpReviews]', err);
    return { error: err instanceof Error ? err.message : 'Sync failed.' };
  }
}

const SYSTEM_PROMPT = `You are responding to Google reviews on behalf of The Anchor, a pub. Always be positive, warm, encouraging, supportive, and inclusive. Responses should feel genuine and personal — not templated. Keep replies concise (2–4 sentences). If the review is negative, acknowledge the experience with empathy, apologise sincerely, and invite the reviewer to get in touch directly. If the review is positive, thank them warmly and express that you look forward to seeing them again.`;

export async function generateAiDraft(reviewId: string): Promise<{ success?: boolean; draft?: string; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: review, error: fetchError } = await supabase
    .from('gbp_reviews')
    .select('id, star_rating, comment, business_profile_id')
    .eq('id', reviewId)
    .eq('business_profile_id', accountId)
    .single<{ id: string; star_rating: number; comment: string | null; business_profile_id: string }>();

  if (fetchError || !review) {
    return { error: 'Review not found.' };
  }

  const userMessage = review.comment
    ? `Star rating: ${review.star_rating}/5\nReview: "${review.comment}"`
    : `Star rating: ${review.star_rating}/5\n(No written comment — rating only)`;

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 200,
    });

    const draft = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!draft) return { error: 'AI returned an empty response.' };

    await supabase
      .from('gbp_reviews')
      .update({ ai_draft: draft, status: 'draft_ready' })
      .eq('id', reviewId)
      .eq('business_profile_id', accountId);

    revalidatePath('/reviews');
    return { success: true, draft };
  } catch (err) {
    console.error('[generateAiDraft]', err);
    return { error: err instanceof Error ? err.message : 'AI generation failed.' };
  }
}

export async function postReply(reviewId: string, comment: string): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: review } = await supabase
    .from('gbp_reviews')
    .select('google_review_id, business_profile_id')
    .eq('id', reviewId)
    .eq('business_profile_id', accountId)
    .single<{ google_review_id: string; business_profile_id: string }>();

  if (!review) return { error: 'Review not found.' };

  try {
    const { token, locationId } = await resolveAccessToken(accountId);
    // Construct full review resource name
    const reviewName = `${locationId}/reviews/${review.google_review_id}`;
    await postGbpReply(reviewName, comment, token);

    await supabase
      .from('gbp_reviews')
      .update({
        reply_comment: comment,
        reply_update_time: new Date().toISOString(),
        status: 'replied',
      })
      .eq('id', reviewId)
      .eq('business_profile_id', accountId);

    revalidatePath('/reviews');
    return { success: true };
  } catch (err) {
    console.error('[postReply]', err);
    return { error: err instanceof Error ? err.message : 'Failed to post reply.' };
  }
}

export async function saveAiDraft(reviewId: string, draft: string): Promise<{ success?: boolean; error?: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { error } = await supabase
    .from('gbp_reviews')
    .update({ ai_draft: draft })
    .eq('id', reviewId)
    .eq('business_profile_id', accountId);

  if (error) return { error: error.message };
  return { success: true };
}
```

**Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Fix any type errors before continuing.

**Step 3: Commit**

```bash
git add src/app/(app)/reviews/actions.ts
git commit -m "feat: add GBP reviews server actions (sync, generate draft, post reply)"
```

---

### Task 5: Cron route and Vercel schedule

**Files:**
- Create: `src/app/api/cron/sync-gbp-reviews/route.ts`
- Modify: `vercel.json`

**Step 1: Write the cron route**

```typescript
import { NextResponse } from 'next/server';

import {
  buildUpsertRow,
  fetchGbpReviews,
  refreshGoogleAccessToken,
} from '@/lib/gbp/reviews';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

function normaliseAuthHeader(value: string | null) {
  if (!value) return '';
  return value.replace(/^Bearer\s+/i, '').trim();
}

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const xCronSecret = request.headers.get('x-cron-secret')?.trim();
  const authHeader = request.headers.get('authorization');
  const headerSecret = xCronSecret || normaliseAuthHeader(authHeader);
  const urlSecret = new URL(request.url).searchParams.get('secret')?.trim() ?? '';

  if (headerSecret !== cronSecret && urlSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();

  // Fetch all active GBP connections
  const { data: connections } = await supabase
    .from('social_connections')
    .select('account_id, access_token, refresh_token, expires_at, metadata')
    .eq('provider', 'gbp')
    .eq('status', 'active')
    .returns<{
      account_id: string;
      access_token: string | null;
      refresh_token: string | null;
      expires_at: string | null;
      metadata: Record<string, unknown> | null;
    }[]>();

  if (!connections?.length) {
    return NextResponse.json({ synced: 0, accounts: 0 });
  }

  let totalSynced = 0;

  for (const conn of connections) {
    if (!conn.access_token || !conn.refresh_token) continue;
    const locationId = conn.metadata?.locationId as string | undefined;
    if (!locationId) continue;

    try {
      let token = conn.access_token;

      // Refresh if needed
      const isExpired =
        conn.expires_at && new Date(conn.expires_at) < new Date(Date.now() + 5 * 60 * 1000);
      if (isExpired) {
        const refreshed = await refreshGoogleAccessToken(conn.refresh_token);
        token = refreshed.accessToken;
        await supabase
          .from('social_connections')
          .update({ access_token: token, expires_at: refreshed.expiresAt })
          .eq('account_id', conn.account_id)
          .eq('provider', 'gbp');
      }

      const reviews = await fetchGbpReviews(locationId, token);
      if (!reviews.length) continue;

      const rows = reviews.map((r) => buildUpsertRow(conn.account_id, r));
      await supabase
        .from('gbp_reviews')
        .upsert(rows, { onConflict: 'business_profile_id,google_review_id', ignoreDuplicates: false });

      totalSynced += rows.length;
    } catch (err) {
      console.error(`[sync-gbp-reviews] Failed for account ${conn.account_id}:`, err);
    }
  }

  return NextResponse.json({ synced: totalSynced, accounts: connections.length });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
```

**Step 2: Add cron schedule to vercel.json**

Open `vercel.json`. Add this entry to the `crons` array:

```json
{
  "path": "/api/cron/sync-gbp-reviews",
  "schedule": "0 * * * *"
}
```

**Step 3: Typecheck**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/app/api/cron/sync-gbp-reviews/route.ts vercel.json
git commit -m "feat: add GBP reviews cron sync route (hourly)"
```

---

### Task 6: Reviews page (server component)

**Files:**
- Create: `src/app/(app)/reviews/page.tsx`

**Step 1: Write the page**

```typescript
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { requireAuthContext } from '@/lib/auth/server';
import type { GbpReview } from '@/types/reviews';
import { ReviewsList } from '@/features/reviews/ReviewsList';

export default async function ReviewsPage() {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  // Check if GBP connection exists
  const { data: connection } = await supabase
    .from('social_connections')
    .select('status, metadata')
    .eq('account_id', accountId)
    .eq('provider', 'gbp')
    .maybeSingle<{ status: string | null; metadata: Record<string, unknown> | null }>();

  const isConnected = connection?.status === 'active' && !!connection?.metadata?.locationId;

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <p className="text-muted-foreground text-lg">
          Connect your Google Business Profile to start managing reviews.
        </p>
        <a
          href="/connections"
          className="text-primary underline underline-offset-4 text-sm"
        >
          Go to Connections →
        </a>
      </div>
    );
  }

  const { data: reviews } = await supabase
    .from('gbp_reviews')
    .select('*')
    .eq('business_profile_id', accountId)
    .order('create_time', { ascending: false })
    .returns<GbpReview[]>();

  const lastSynced = reviews?.[0]?.syncedAt ?? null;
  const pendingCount = reviews?.filter((r) => r.status === 'pending').length ?? 0;
  const totalCount = reviews?.length ?? 0;
  const avgRating =
    totalCount > 0
      ? (reviews!.reduce((sum, r) => sum + r.starRating, 0) / totalCount).toFixed(1)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Google Business Profile reviews for The Anchor
          </p>
        </div>
      </div>

      <ReviewsList
        reviews={reviews ?? []}
        lastSynced={lastSynced}
        pendingCount={pendingCount}
        avgRating={avgRating}
        totalCount={totalCount}
      />
    </div>
  );
}
```

**Step 2: Typecheck**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/app/(app)/reviews/page.tsx
git commit -m "feat: add Reviews server page with GBP connection check"
```

---

### Task 7: ReviewCard client component

**Files:**
- Create: `src/features/reviews/ReviewCard.tsx`

**Step 1: Write the component**

```typescript
'use client';

import { useState, useTransition } from 'react';
import { Star } from 'lucide-react';

import type { GbpReview } from '@/types/reviews';
import { generateAiDraft, postReply, saveAiDraft } from '@/app/(app)/reviews/actions';

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          className={n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}
        />
      ))}
    </div>
  );
}

export function ReviewCard({ review }: { review: GbpReview }) {
  const [draft, setDraft] = useState(review.aiDraft ?? '');
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(review.status === 'replied');
  const [isPending, startTransition] = useTransition();

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      const result = await generateAiDraft(review.id);
      if (result.error) { setError(result.error); return; }
      setDraft(result.draft ?? '');
    });
  };

  const handlePost = () => {
    if (!draft.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await postReply(review.id, draft.trim());
      if (result.error) { setError(result.error); return; }
      setPosted(true);
    });
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    // Persist draft on blur — handled separately
  };

  const handleDraftBlur = () => {
    if (draft !== review.aiDraft) {
      startTransition(async () => { await saveAiDraft(review.id, draft); });
    }
  };

  const date = new Date(review.createTime).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold text-sm">{review.reviewerName}</p>
          <StarRating rating={review.starRating} />
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
            review.status === 'replied'
              ? 'bg-green-100 text-green-700'
              : review.status === 'draft_ready'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {review.status === 'replied' ? 'Replied' : review.status === 'draft_ready' ? 'Draft ready' : 'Needs reply'}
        </span>
      </div>

      {review.comment && (
        <p className="text-sm text-foreground/80 leading-relaxed">{review.comment}</p>
      )}

      {posted && review.replyComment && (
        <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground border border-border/50">
          <p className="text-xs font-medium mb-1">Your reply</p>
          <p>{review.replyComment}</p>
        </div>
      )}

      {!posted && (
        <div className="space-y-2 pt-1">
          {(draft || review.status === 'draft_ready') ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onBlur={handleDraftBlur}
                rows={4}
                disabled={isPending}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                placeholder="Edit your response here..."
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePost}
                  disabled={isPending || !draft.trim()}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending ? 'Posting...' : 'Post reply'}
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isPending}
                  className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Regenerate
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {isPending ? 'Generating...' : 'Generate response'}
            </button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Typecheck**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/features/reviews/ReviewCard.tsx
git commit -m "feat: add ReviewCard component with AI draft and post actions"
```

---

### Task 8: ReviewsList client component

**Files:**
- Create: `src/features/reviews/ReviewsList.tsx`

**Step 1: Write the component**

```typescript
'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';

import type { GbpReview, ReviewStatus } from '@/types/reviews';
import { ReviewCard } from './ReviewCard';
import { syncGbpReviews } from '@/app/(app)/reviews/actions';

interface ReviewsListProps {
  reviews: GbpReview[];
  lastSynced: string | null;
  pendingCount: number;
  avgRating: string | null;
  totalCount: number;
}

const STATUS_FILTERS: { label: string; value: ReviewStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Needs reply', value: 'pending' },
  { label: 'Replied', value: 'replied' },
];

const STAR_FILTERS = [0, 5, 4, 3, 2, 1];

export function ReviewsList({ reviews, lastSynced, pendingCount, avgRating, totalCount }: ReviewsListProps) {
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('all');
  const [starFilter, setStarFilter] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRefresh = () => {
    setSyncError(null);
    startTransition(async () => {
      const result = await syncGbpReviews();
      if (result.error) setSyncError(result.error);
    });
  };

  const filtered = reviews.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (starFilter > 0 && r.starRating !== starFilter) return false;
    return true;
  });

  const syncedText = lastSynced
    ? `Last synced ${new Date(lastSynced).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : 'Not yet synced';

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap gap-6 items-center justify-between">
        <div className="flex gap-8">
          {avgRating && (
            <div>
              <p className="text-2xl font-bold">{avgRating} ★</p>
              <p className="text-xs text-muted-foreground">{totalCount} reviews</p>
            </div>
          )}
          {pendingCount > 0 && (
            <div>
              <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">need{pendingCount === 1 ? 's' : ''} a reply</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">{syncedText}</p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw size={14} className={isPending ? 'animate-spin' : ''} />
            {isPending ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {syncError && <p className="w-full text-xs text-destructive">{syncError}</p>}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              statusFilter === f.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-input hover:bg-accent'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="w-px bg-border mx-1" />
        {STAR_FILTERS.map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setStarFilter(star === starFilter ? 0 : star)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              starFilter === star && star > 0
                ? 'bg-amber-100 text-amber-700 border-amber-300'
                : 'bg-background border-input hover:bg-accent'
            }`}
          >
            {star === 0 ? 'All stars' : `${star} ★`}
          </button>
        ))}
      </div>

      {/* Review cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground text-sm">
          {reviews.length === 0
            ? 'No reviews yet. Click Refresh to sync from Google.'
            : 'No reviews match the selected filters.'}
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Typecheck**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/features/reviews/ReviewsList.tsx
git commit -m "feat: add ReviewsList component with status/star filters and refresh"
```

---

### Task 9: Add Reviews to sidebar navigation

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

**Step 1: Add the import and nav item**

In `src/components/layout/Sidebar.tsx`:

1. Add `Star` to the lucide-react import line:
   ```typescript
   import { ..., Star } from 'lucide-react';
   ```

2. Add to `NAV_ITEMS` array (after `Campaigns`, before `Connections`):
   ```typescript
   { label: 'Reviews', href: '/reviews', icon: Star },
   ```

**Step 2: Run lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Fix any issues.

**Step 3: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: add Reviews link to sidebar navigation"
```

---

### Task 10: Smoke test end-to-end

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Manual verification checklist**

- [ ] Navigate to `/reviews` — page loads without error
- [ ] If no GBP connection active, see the "Connect your Google Business Profile" prompt with a link to `/connections`
- [ ] If GBP connected, see the summary bar and empty state "No reviews yet"
- [ ] Click "Refresh" — loading spinner shows, reviews appear if any exist on Google
- [ ] Click "Generate response" on a pending review — draft appears in textarea
- [ ] Edit the draft text
- [ ] Click "Post reply" — status changes to "Replied"
- [ ] Status filters work (All / Needs reply / Replied)
- [ ] Star filters work

**Step 3: Full CI verify**

```bash
npm run ci:verify
```

Expected: lint passes, typecheck passes, tests pass, build succeeds.

**Step 4: Final commit if any fixups needed**

```bash
git add -p
git commit -m "fix: address CI issues from GBP reviews feature"
```

---

### Task 11: Token type fix (camelCase DB mapping)

> **Note:** The `GbpReview` type uses camelCase but Supabase returns snake_case. The Reviews page passes raw DB rows — you may need to map them.

**Step 1: Check if the project uses a `fromDb` helper**

```bash
grep -r "fromDb" src/ --include="*.ts" --include="*.tsx" -l
```

**Step 2: If `fromDb` exists, use it in the page**

In `src/app/(app)/reviews/page.tsx`, update the query:

```typescript
import { fromDb } from '@/lib/utils';

// After the Supabase query:
const mappedReviews = (reviews ?? []).map((r) => fromDb<GbpReview>(r));
```

Pass `mappedReviews` instead of `reviews` to `ReviewsList`.

**Step 3: If `fromDb` doesn't exist, add a simple mapper in `src/types/reviews.ts`**

```typescript
export function reviewFromDb(row: Record<string, unknown>): GbpReview {
  return {
    id: row.id as string,
    businessProfileId: row.business_profile_id as string,
    googleReviewId: row.google_review_id as string,
    reviewerName: row.reviewer_name as string,
    starRating: row.star_rating as number,
    comment: (row.comment as string | null) ?? null,
    createTime: row.create_time as string,
    updateTime: row.update_time as string,
    replyComment: (row.reply_comment as string | null) ?? null,
    replyUpdateTime: (row.reply_update_time as string | null) ?? null,
    aiDraft: (row.ai_draft as string | null) ?? null,
    status: row.status as ReviewStatus,
    syncedAt: row.synced_at as string,
  };
}
```

Use `reviewFromDb` in the page and any other place raw DB rows are consumed.

**Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add -p
git commit -m "fix: map snake_case DB rows to camelCase GbpReview type"
```
