# Tournament API Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public read-only JSON API at `/api/feed/[tournamentId]` that brand websites can poll to display tournament fixture data, authenticated via per-tournament API keys managed in the settings modal.

**Architecture:** A single Next.js API route handler validates an `x-api-key` header against a `feed_api_key` column on the `tournaments` table, then returns a curated JSON payload of fixtures with optional filters. Two server actions manage key generation/disable. The settings modal gains an "API Feed" section.

**Tech Stack:** Next.js 16 App Router API routes, Supabase (service-role client), Zod validation, existing rate-limit utility, crypto for key generation.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260510200000_add_feed_api_key.sql` | Create | Add nullable `feed_api_key` column + partial unique index |
| `src/types/tournament.ts` | Modify | Add `feedApiKey` field to `Tournament` interface |
| `src/lib/tournament/queries.ts` | Modify | Map `feed_api_key` in `mapTournament` |
| `src/app/actions/tournament.ts` | Modify | Add `regenerateFeedApiKey` and `disableFeedApiKey` server actions |
| `src/app/api/feed/[tournamentId]/route.ts` | Create | GET + OPTIONS route handler with auth, rate limiting, filters, CORS, caching |
| `src/features/tournament/components/TournamentSettingsModal.tsx` | Modify | Add "API Feed" section with key display, generate, disable, endpoint URL, code snippet |
| `tests/feed-route.test.ts` | Create | Unit tests for the API route |
| `docs/api-feed.md` | Create | User-facing API documentation |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260510200000_add_feed_api_key.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add feed API key column for public fixture feed
ALTER TABLE tournaments
  ADD COLUMN feed_api_key text;

CREATE UNIQUE INDEX idx_tournaments_feed_api_key
  ON tournaments (feed_api_key)
  WHERE feed_api_key IS NOT NULL;

COMMENT ON COLUMN tournaments.feed_api_key IS
  'Public access token for the fixture feed API. NULL = feed disabled.';
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push`
Expected: Migration applies without error.

- [ ] **Step 3: Verify column exists**

Run via Supabase MCP or SQL editor:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tournaments' AND column_name = 'feed_api_key';
```
Expected: One row with `data_type = 'text'`, `is_nullable = 'YES'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260510200000_add_feed_api_key.sql
git commit -m "feat(tournament): add feed_api_key column to tournaments table"
```

---

### Task 2: Type & Query Updates

**Files:**
- Modify: `src/types/tournament.ts:15-29` (Tournament interface)
- Modify: `src/lib/tournament/queries.ts:14-29` (mapTournament function)

- [ ] **Step 1: Add `feedApiKey` to the Tournament interface**

In `src/types/tournament.ts`, add `feedApiKey` to the `Tournament` interface after the `postLeadHours` field:

```typescript
export interface Tournament {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  status: TournamentStatus;
  baseImageSquareId: string | null;
  baseImageStoryId: string | null;
  houseRulesText: string | null;
  postTemplate: string;
  platforms: TournamentPlatform[];
  postLeadHours: number;
  feedApiKey: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Update `mapTournament` in queries.ts**

In `src/lib/tournament/queries.ts`, add the `feedApiKey` mapping to `mapTournament`:

```typescript
function mapTournament(row: Record<string, unknown>): Tournament {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    slug: row.slug as string,
    status: row.status as TournamentStatus,
    baseImageSquareId: (row.base_image_square_id as string) ?? null,
    baseImageStoryId: (row.base_image_story_id as string) ?? null,
    houseRulesText: (row.house_rules_text as string) ?? null,
    postTemplate: row.post_template as string,
    platforms: row.platforms as TournamentPlatform[],
    postLeadHours: row.post_lead_hours as number,
    feedApiKey: (row.feed_api_key as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean — no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/tournament.ts src/lib/tournament/queries.ts
git commit -m "feat(tournament): add feedApiKey to Tournament type and query mapper"
```

---

### Task 3: Server Actions for Key Management

**Files:**
- Modify: `src/app/actions/tournament.ts` (append two new actions)

- [ ] **Step 1: Add `regenerateFeedApiKey` action**

Append to the end of `src/app/actions/tournament.ts`:

```typescript
// ---------------------------------------------------------------------------
// regenerateFeedApiKey
// ---------------------------------------------------------------------------

export async function regenerateFeedApiKey(
  tournamentId: string,
): Promise<{ success: true; apiKey: string } | { success: false; error: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const crypto = await import('node:crypto');
    const apiKey = crypto.randomBytes(16).toString('hex');

    const db = createServiceSupabaseClient();
    const { error } = await db
      .from('tournaments')
      .update({ feed_api_key: apiKey, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true, apiKey };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 2: Add `disableFeedApiKey` action**

Append to the end of `src/app/actions/tournament.ts`:

```typescript
// ---------------------------------------------------------------------------
// disableFeedApiKey
// ---------------------------------------------------------------------------

export async function disableFeedApiKey(
  tournamentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();

    const tournament = await getTournamentById(supabase, tournamentId, accountId);
    if (!tournament) return { success: false, error: 'Tournament not found' };

    const db = createServiceSupabaseClient();
    const { error } = await db
      .from('tournaments')
      .update({ feed_api_key: null, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .eq('account_id', accountId);

    if (error) return { success: false, error: error.message };

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean — no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/tournament.ts
git commit -m "feat(tournament): add regenerateFeedApiKey and disableFeedApiKey server actions"
```

---

### Task 4: API Route Handler

**Files:**
- Create: `src/app/api/feed/[tournamentId]/route.ts`

- [ ] **Step 1: Create the route file**

Create `src/app/api/feed/[tournamentId]/route.ts`:

```typescript
import { NextResponse } from 'next/server';

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getRateLimitKey, isRateLimited } from '@/lib/auth/rate-limit';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ROUNDS = new Set([
  'group_stage',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tournamentId: string }> },
): Promise<NextResponse> {
  const { tournamentId } = await params;

  // 1. Rate limit — before any DB query
  const rateLimitKey = getRateLimitKey(request, `feed:${tournamentId}`);
  const limited = await isRateLimited({ key: rateLimitKey, maxAttempts: 60, windowMs: 60_000 });
  if (limited) {
    return errorResponse(429, 'Rate limit exceeded');
  }

  // 2. Validate UUID format
  if (!UUID_RE.test(tournamentId)) {
    return errorResponse(400, 'Invalid tournament ID format');
  }

  // 3. Validate query parameters
  const url = new URL(request.url);
  const errors: string[] = [];

  const showingParam = url.searchParams.get('showing');
  const roundParam = url.searchParams.get('round');
  const groupParam = url.searchParams.get('group');
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const confirmedParam = url.searchParams.get('confirmed');

  let showingFilter: boolean | null = true; // default: only showing fixtures
  if (showingParam !== null) {
    if (showingParam === 'true') showingFilter = true;
    else if (showingParam === 'false') showingFilter = false;
    else errors.push('showing must be "true" or "false"');
  }

  if (roundParam !== null && !VALID_ROUNDS.has(roundParam)) {
    errors.push(`round must be one of: ${[...VALID_ROUNDS].join(', ')}`);
  }

  let fromDate: Date | null = null;
  let toDate: Date | null = null;

  if (fromParam !== null) {
    fromDate = new Date(fromParam);
    if (isNaN(fromDate.getTime())) errors.push('from must be a valid ISO 8601 datetime');
  }
  if (toParam !== null) {
    toDate = new Date(toParam);
    if (isNaN(toDate.getTime())) errors.push('to must be a valid ISO 8601 datetime');
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    errors.push('from must be earlier than or equal to to');
  }

  let confirmedFilter: boolean | null = null;
  if (confirmedParam !== null) {
    if (confirmedParam === 'true') confirmedFilter = true;
    else if (confirmedParam === 'false') confirmedFilter = false;
    else errors.push('confirmed must be "true" or "false"');
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: errors },
      { status: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
    );
  }

  // 4. Look up tournament + validate API key
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return errorResponse(401, 'Missing or invalid API key');
  }

  const supabase = createServiceSupabaseClient();

  let tournament: { id: string; name: string; slug: string; status: string; feed_api_key: string | null } | null;
  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, slug, status, feed_api_key')
      .eq('id', tournamentId)
      .maybeSingle();

    if (error) throw error;
    tournament = data;
  } catch {
    return errorResponse(500, 'Internal server error');
  }

  if (!tournament || !tournament.feed_api_key) {
    return errorResponse(404, 'Tournament not found');
  }

  if (tournament.feed_api_key !== apiKey) {
    return errorResponse(401, 'Missing or invalid API key');
  }

  // 5. Query fixtures with filters
  try {
    let query = supabase
      .from('tournament_fixtures')
      .select('id, match_number, round, group_name, team_a, team_b, teams_confirmed, kick_off_at, venue_city, showing, showing_note, booking_url')
      .eq('tournament_id', tournamentId)
      .order('kick_off_at', { ascending: true });

    if (showingFilter !== null) {
      query = query.eq('showing', showingFilter);
    }
    if (roundParam) {
      query = query.eq('round', roundParam);
    }
    if (groupParam) {
      query = query.eq('group_name', groupParam);
    }
    if (fromDate) {
      query = query.gte('kick_off_at', fromDate.toISOString());
    }
    if (toDate) {
      query = query.lte('kick_off_at', toDate.toISOString());
    }
    if (confirmedFilter !== null) {
      query = query.eq('teams_confirmed', confirmedFilter);
    }

    const { data: fixtures, error: fixturesError } = await query;
    if (fixturesError) throw fixturesError;

    // 6. Build curated response
    const body = {
      tournament: {
        id: tournament.id,
        name: tournament.name,
        slug: tournament.slug,
        status: tournament.status,
      },
      fixtures: (fixtures ?? []).map((f: Record<string, unknown>) => ({
        id: f.id,
        matchNumber: f.match_number,
        round: f.round,
        groupName: f.group_name ?? null,
        teamA: f.team_a,
        teamB: f.team_b,
        teamsConfirmed: f.teams_confirmed,
        kickOffAt: f.kick_off_at,
        venueCity: f.venue_city ?? null,
        showing: f.showing,
        showingNote: f.showing_note ?? null,
        bookingUrl: f.booking_url ?? null,
      })),
      meta: {
        total: (fixtures ?? []).length,
        generatedAt: new Date().toISOString(),
      },
    };

    return NextResponse.json(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 's-maxage=300, stale-while-revalidate=60',
        'Vary': 'x-api-key',
      },
    });
  } catch {
    return errorResponse(500, 'Internal server error');
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean — no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/feed/\[tournamentId\]/route.ts
git commit -m "feat(tournament): add public fixture feed API route"
```

---

### Task 5: API Route Tests

**Files:**
- Create: `tests/feed-route.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/feed-route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockLte = vi.fn();
const mockOrder = vi.fn();

const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect.mockReturnValue({
    eq: mockEq.mockReturnValue({
      maybeSingle: mockMaybeSingle,
      eq: mockEq,
      gte: mockGte.mockReturnValue({ lte: mockLte, eq: mockEq }),
      lte: mockLte,
      order: mockOrder,
    }),
    order: mockOrder.mockReturnValue({
      eq: mockEq,
    }),
  }),
});

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock('@/lib/auth/rate-limit', () => ({
  getRateLimitKey: (_req: Request, prefix: string) => `test:${prefix}`,
  isRateLimited: vi.fn().mockResolvedValue(false),
}));

import { GET, OPTIONS } from '@/app/api/feed/[tournamentId]/route';
import { isRateLimited } from '@/lib/auth/rate-limit';

function makeRequest(tournamentId: string, opts: { apiKey?: string; query?: string } = {}): [Request, { params: Promise<{ tournamentId: string }> }] {
  const url = `http://localhost/api/feed/${tournamentId}${opts.query ?? ''}`;
  const headers = new Headers();
  if (opts.apiKey) headers.set('x-api-key', opts.apiKey);
  return [
    new Request(url, { headers }),
    { params: Promise.resolve({ tournamentId }) },
  ];
}

const VALID_UUID = 'f40ef35f-5a1c-4409-8d02-27f2f97d0a0e';
const VALID_KEY = 'abc123def456abc123def456abc123de';

const TOURNAMENT_ROW = {
  id: VALID_UUID,
  name: 'Test Cup',
  slug: 'test-cup',
  status: 'active',
  feed_api_key: VALID_KEY,
};

const FIXTURE_ROWS = [
  {
    id: 'fix-1',
    match_number: 1,
    round: 'group_stage',
    group_name: 'Group A',
    team_a: 'Team One',
    team_b: 'Team Two',
    teams_confirmed: true,
    kick_off_at: '2026-06-11T19:00:00Z',
    venue_city: 'London',
    showing: true,
    showing_note: null,
    booking_url: 'https://example.com/book',
  },
];

describe('GET /api/feed/[tournamentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRateLimited).mockResolvedValue(false);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(isRateLimited).mockResolvedValue(true);
    const res = await GET(...makeRequest(VALID_UUID, { apiKey: VALID_KEY }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await GET(...makeRequest('not-a-uuid', { apiKey: VALID_KEY }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid tournament ID');
  });

  it('returns 400 for invalid query params', async () => {
    const res = await GET(...makeRequest(VALID_UUID, { apiKey: VALID_KEY, query: '?showing=maybe' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toContain('showing must be "true" or "false"');
  });

  it('returns 400 when from > to', async () => {
    const res = await GET(...makeRequest(VALID_UUID, { apiKey: VALID_KEY, query: '?from=2026-07-01T00:00:00Z&to=2026-06-01T00:00:00Z' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toContain('from must be earlier than or equal to to');
  });

  it('returns 401 when no API key', async () => {
    const res = await GET(...makeRequest(VALID_UUID));
    expect(res.status).toBe(401);
  });

  it('returns 401 when wrong API key', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: TOURNAMENT_ROW, error: null });
    const res = await GET(...makeRequest(VALID_UUID, { apiKey: 'wrong-key' }));
    expect(res.status).toBe(401);
  });

  it('returns 404 when tournament not found', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await GET(...makeRequest(VALID_UUID, { apiKey: VALID_KEY }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when feed disabled (feed_api_key is null)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { ...TOURNAMENT_ROW, feed_api_key: null }, error: null });
    const res = await GET(...makeRequest(VALID_UUID, { apiKey: VALID_KEY }));
    expect(res.status).toBe(404);
  });

  it('returns 200 with fixtures on valid request', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: TOURNAMENT_ROW, error: null });
    mockOrder.mockReturnValueOnce({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: FIXTURE_ROWS, error: null }),
      }),
    });

    const res = await GET(...makeRequest(VALID_UUID, { apiKey: VALID_KEY }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tournament.name).toBe('Test Cup');
    expect(body.fixtures).toHaveLength(1);
    expect(body.fixtures[0].matchNumber).toBe(1);
    expect(body.fixtures[0].teamA).toBe('Team One');
    expect(body.meta.total).toBe(1);

    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300');
    expect(res.headers.get('Vary')).toBe('x-api-key');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns CORS headers on all responses', async () => {
    const res = await GET(...makeRequest('bad', { apiKey: VALID_KEY }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('OPTIONS /api/feed/[tournamentId]', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('x-api-key');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/feed-route.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/feed-route.test.ts
git commit -m "test(tournament): add unit tests for feed API route"
```

---

### Task 6: Settings Modal — API Feed Section

**Files:**
- Modify: `src/features/tournament/components/TournamentSettingsModal.tsx`

- [ ] **Step 1: Add imports for new actions and icons**

In `TournamentSettingsModal.tsx`, update the imports:

Add `Copy, Eye, EyeOff, RefreshCw, Code` to the lucide-react import:
```typescript
import { X, Loader2, ImageIcon, Check, Copy, Eye, EyeOff, RefreshCw, Code } from 'lucide-react';
```

Add the new server actions to the tournament actions import:
```typescript
import {
  updateTournament,
  updateTournamentStatus,
  updateTournamentBaseImages,
  getMediaAssetsForPicker,
  deleteTournament,
  regenerateFeedApiKey,
  disableFeedApiKey,
} from '@/app/actions/tournament';
```

- [ ] **Step 2: Add state variables for the feed section**

Inside the `TournamentSettingsModal` component, after the existing state declarations (after `const router = useRouter();`), add:

```typescript
const [feedApiKey, setFeedApiKey] = useState(tournament.feedApiKey);
const [feedKeyVisible, setFeedKeyVisible] = useState(false);
const [feedLoading, setFeedLoading] = useState(false);
const [feedCopied, setFeedCopied] = useState<'key' | 'url' | 'snippet' | null>(null);
```

Also add to the `useEffect` that resets state when the modal opens (the one that runs on `[open, tournament.id]`), add these lines at the end of that effect's body, before the comment:

```typescript
setFeedApiKey(tournament.feedApiKey);
setFeedKeyVisible(false);
setFeedCopied(null);
```

- [ ] **Step 3: Add handler functions**

After the existing `handleDeleteTournament` function, add:

```typescript
async function handleGenerateFeedKey() {
  if (feedApiKey) {
    const confirmed = window.confirm(
      'Regenerating the API key will immediately invalidate the current key. Any brand sites using the old key will stop working. Continue?',
    );
    if (!confirmed) return;
  }
  setFeedLoading(true);
  setError(null);
  try {
    const result = await regenerateFeedApiKey(tournament.id);
    if (result.success) {
      setFeedApiKey(result.apiKey);
      setFeedKeyVisible(true);
    } else {
      setError(result.error);
    }
  } finally {
    setFeedLoading(false);
  }
}

async function handleDisableFeedKey() {
  const confirmed = window.confirm(
    'Disabling the API feed will immediately stop serving data to any brand sites using this key. Continue?',
  );
  if (!confirmed) return;
  setFeedLoading(true);
  setError(null);
  try {
    const result = await disableFeedApiKey(tournament.id);
    if (result.success) {
      setFeedApiKey(null);
      setFeedKeyVisible(false);
    } else {
      setError(result.error ?? 'Failed to disable feed');
    }
  } finally {
    setFeedLoading(false);
  }
}

function copyToClipboard(text: string, label: 'key' | 'url' | 'snippet') {
  navigator.clipboard.writeText(text);
  setFeedCopied(label);
  setTimeout(() => setFeedCopied(null), 2000);
}
```

- [ ] **Step 4: Add the API Feed section JSX**

In the JSX, add the API Feed section. Insert it BEFORE the delete section (before `<div className="border-t pt-4 mt-4">`). Add:

```tsx
<div className="border-t pt-4 mt-4">
  <label className="block text-sm font-medium mb-2">API Feed</label>
  <p className="text-xs text-muted-foreground mb-3">
    Enable a public JSON feed so your brand website can display fixture data.
  </p>

  <div className="space-y-3">
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        feedApiKey
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-600'
      }`}>
        {feedApiKey ? 'Enabled' : 'Disabled'}
      </span>
    </div>

    {feedApiKey && (
      <>
        <div>
          <span className="text-xs font-medium text-muted-foreground">API Key</span>
          <div className="flex items-center gap-1 mt-1">
            <input
              type="text"
              readOnly
              value={feedKeyVisible ? feedApiKey : '••••••••••••••••••••••••••••••••'}
              className="flex-1 rounded-md border bg-muted/30 px-3 py-1.5 text-xs font-mono"
            />
            <button
              type="button"
              onClick={() => setFeedKeyVisible(!feedKeyVisible)}
              className="rounded p-1.5 text-muted-foreground hover:text-foreground"
              title={feedKeyVisible ? 'Hide' : 'Reveal'}
            >
              {feedKeyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => copyToClipboard(feedApiKey, 'key')}
              className="rounded p-1.5 text-muted-foreground hover:text-foreground"
              title="Copy key"
            >
              {feedCopied === 'key' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <span className="text-xs font-medium text-muted-foreground">Endpoint</span>
          <div className="flex items-center gap-1 mt-1">
            <input
              type="text"
              readOnly
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/feed/${tournament.id}`}
              className="flex-1 rounded-md border bg-muted/30 px-3 py-1.5 text-xs font-mono"
            />
            <button
              type="button"
              onClick={() => copyToClipboard(`${window.location.origin}/api/feed/${tournament.id}`, 'url')}
              className="rounded p-1.5 text-muted-foreground hover:text-foreground"
              title="Copy URL"
            >
              {feedCopied === 'url' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => {
              const snippet = `fetch('${typeof window !== 'undefined' ? window.location.origin : ''}/api/feed/${tournament.id}', {\n  headers: { 'x-api-key': '${feedApiKey}' }\n})\n  .then(res => res.json())\n  .then(data => console.log(data.fixtures));`;
              copyToClipboard(snippet, 'snippet');
            }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Code className="h-3 w-3" />
            {feedCopied === 'snippet' ? 'Copied!' : 'Copy code snippet'}
          </button>
        </div>
      </>
    )}

    <div className="flex gap-2">
      <button
        type="button"
        onClick={handleGenerateFeedKey}
        disabled={feedLoading || saving}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {feedLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {feedApiKey ? 'Regenerate Key' : 'Enable Feed'}
      </button>
      {feedApiKey && (
        <button
          type="button"
          onClick={handleDisableFeedKey}
          disabled={feedLoading || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
        >
          Disable Feed
        </button>
      )}
    </div>
  </div>
</div>
```

- [ ] **Step 5: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: Clean — no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/tournament/components/TournamentSettingsModal.tsx
git commit -m "feat(tournament): add API Feed section to settings modal"
```

---

### Task 7: API Documentation

**Files:**
- Create: `docs/api-feed.md`

- [ ] **Step 1: Write the documentation**

Create `docs/api-feed.md`:

```markdown
# Tournament Fixture Feed API

A read-only JSON API for displaying tournament fixture data on your brand website.

## Quick Start

1. Open your tournament in the CheersAI dashboard
2. Click the settings icon and scroll to "API Feed"
3. Click "Enable Feed" to generate an API key
4. Use the key to fetch fixtures:

\`\`\`javascript
const response = await fetch(
  'https://your-cheersai-domain.com/api/feed/YOUR_TOURNAMENT_ID',
  { headers: { 'x-api-key': 'YOUR_API_KEY' } }
);
const data = await response.json();
console.log(data.fixtures);
\`\`\`

## Authentication

Every request must include an `x-api-key` header with your tournament's API key.

The API key is a public access token — it is safe to use from browser-side JavaScript. It identifies your site and prevents casual scraping, but it does not protect confidential data (the fixture data is inherently public).

## Endpoint

### `GET /api/feed/{tournamentId}`

Returns tournament metadata and fixtures.

### Query Parameters

All parameters are optional.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `showing` | boolean | `true` | Filter by whether the venue is screening the fixture. |
| `round` | string | — | Filter by round: `group_stage`, `round_of_32`, `round_of_16`, `quarter_final`, `semi_final`, `third_place`, `final` |
| `group` | string | — | Filter by group name, e.g. `Group A` |
| `from` | ISO 8601 | — | Return fixtures with kick-off at or after this time |
| `to` | ISO 8601 | — | Return fixtures with kick-off at or before this time |
| `confirmed` | boolean | — | Filter by whether teams are confirmed |

### Example: Get all group stage fixtures being shown

\`\`\`
GET /api/feed/{id}?round=group_stage&showing=true
\`\`\`

### Example: Get fixtures for a specific date range

\`\`\`
GET /api/feed/{id}?from=2026-06-11T00:00:00Z&to=2026-06-15T23:59:59Z
\`\`\`

## Response Format

### Success (200)

\`\`\`json
{
  "tournament": {
    "id": "f40ef35f-...",
    "name": "FIFA World Cup 2026",
    "slug": "fifa-world-cup-2026",
    "status": "active"
  },
  "fixtures": [
    {
      "id": "abc123...",
      "matchNumber": 1,
      "round": "group_stage",
      "groupName": "Group A",
      "teamA": "Mexico",
      "teamB": "South Africa",
      "teamsConfirmed": true,
      "kickOffAt": "2026-06-11T19:00:00Z",
      "venueCity": "Mexico City",
      "showing": true,
      "showingNote": "Big screen in the beer garden",
      "bookingUrl": "https://example.com/book"
    }
  ],
  "meta": {
    "total": 48,
    "generatedAt": "2026-05-10T14:30:00Z"
  }
}
\`\`\`

### Errors

| Status | Meaning |
|--------|---------|
| 400 | Invalid tournament ID format or invalid query parameters |
| 401 | Missing or invalid API key |
| 404 | Tournament not found or feed not enabled |
| 429 | Rate limit exceeded (60 requests per minute per IP) |
| 500 | Internal server error |

Error responses always include an `error` field:

\`\`\`json
{ "error": "Missing or invalid API key" }
\`\`\`

## Rate Limiting

The feed allows 60 requests per minute per IP address per tournament. If you exceed this, you will receive a 429 response. Poll no more frequently than once per minute.

## Caching

Successful responses are cached for up to 5 minutes at the CDN level. Changes to fixtures (team names, kick-off times, showing status) will be reflected within 5 minutes.

## Managing Your API Key

- **Enable**: Click "Enable Feed" in tournament settings to generate a key
- **Regenerate**: Click "Regenerate Key" to create a new key. The old key stops working immediately.
- **Disable**: Click "Disable Feed" to turn off the API. All requests will return 404.

## CORS

The API supports cross-origin requests from any domain. You can call it directly from browser JavaScript on your website.
\`\`\`

- [ ] **Step 2: Commit**

```bash
git add docs/api-feed.md
git commit -m "docs: add tournament fixture feed API documentation"
```

---

### Task 8: Verification

- [ ] **Step 1: Run full verification pipeline**

Run: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
Expected: All four checks pass with no errors.

- [ ] **Step 2: Manual smoke test**

1. Start the dev server: `npm run dev`
2. Navigate to a tournament in the dashboard
3. Open settings modal → verify "API Feed" section appears
4. Click "Enable Feed" → verify a 32-char hex key appears
5. Copy the endpoint URL and API key
6. In a terminal, run:
   ```bash
   curl -s -H "x-api-key: YOUR_KEY" http://localhost:3000/api/feed/YOUR_TOURNAMENT_ID | jq .
   ```
7. Verify the response matches the expected JSON shape
8. Test filters: `?round=group_stage`, `?showing=false`, `?from=2026-06-11T00:00:00Z`
9. Test errors: remove the API key header (401), use wrong key (401), use invalid UUID (400)
10. Click "Regenerate Key" → verify confirmation dialog → verify old key stops working
11. Click "Disable Feed" → verify confirmation dialog → verify feed returns 404

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(tournament): address verification feedback for feed API"
```
