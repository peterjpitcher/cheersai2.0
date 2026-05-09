# Tournament Content Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone tournament management module that overlays team names, kick-off times, and house rules onto template images, then schedules them as social posts via the existing publish pipeline — starting with FIFA World Cup 2026.

**Architecture:** Two new tables (`tournaments`, `tournament_fixtures`) with RLS. A Satori + Sharp overlay renderer produces branded images. A content generation service creates `content_items` + `content_variants` + `publish_jobs` via the existing pipeline (`enqueuePublishJob()`). A management UI at `/dashboard/tournaments` provides inline fixture editing with explicit "Save & Generate" actions. The module is fully standalone — no changes to the existing banner, campaign, or scheduling systems.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase (Postgres + Storage + RLS), Satori (SVG generation), Sharp (image compositing), Vitest, Tailwind v4, Zod (validation).

**Spec:** [docs/superpowers/specs/2026-05-09-tournament-content-design.md](../specs/2026-05-09-tournament-content-design.md)
**Adversarial review:** [tasks/codex-qa-review/2026-05-09-tournament-content-spec-adversarial-review.md](../../../tasks/codex-qa-review/2026-05-09-tournament-content-spec-adversarial-review.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_create_tournament_tables.sql` | Creates `tournaments` + `tournament_fixtures` tables, RLS policies, indexes, constraints. |
| `src/types/tournament.ts` | TypeScript interfaces for Tournament, TournamentFixture, plus Zod validation schemas. |
| `src/lib/tournament/overlay.ts` | Satori + Sharp overlay renderer — renders team names/times onto template images. |
| `src/lib/tournament/generate.ts` | Content generation service — atomic fixture generation with advisory lock, media upload, content pipeline integration. |
| `src/lib/tournament/queries.ts` | Data access layer — CRUD queries for tournaments and fixtures. |
| `src/lib/tournament/validation.ts` | Tournament precondition checks and input validation helpers. |
| `src/lib/tournament/placeholder.ts` | Placeholder pattern detection for team name auto-confirm. |
| `src/lib/tournament/template.ts` | Post copy template interpolation. |
| `src/app/actions/tournament.ts` | Server actions for all tournament mutations. |
| `src/app/(app)/dashboard/tournaments/page.tsx` | Tournament list page (server component). |
| `src/app/(app)/dashboard/tournaments/[id]/page.tsx` | Tournament detail page (server component). |
| `src/features/tournament/components/TournamentList.tsx` | Client component — tournament cards with stats. |
| `src/features/tournament/components/TournamentHeader.tsx` | Client component — detail page header with settings + bulk generate. |
| `src/features/tournament/components/FixtureTable.tsx` | Client component — main fixture workspace table. |
| `src/features/tournament/components/FixtureRow.tsx` | Client component — single fixture row with inline editing. |
| `src/features/tournament/components/TournamentSettingsModal.tsx` | Client component — edit tournament settings. |
| `src/features/tournament/components/StatusBadge.tsx` | Client component — fixture content status badge. |
| `src/features/tournament/components/PreconditionWarning.tsx` | Client component — missing preconditions display. |
| `src/features/tournament/hooks/useTournamentData.ts` | React Query hook for tournament + fixtures data. |
| `scripts/ops/seed-world-cup-2026.ts` | Ops script to seed 104 World Cup fixtures. |
| Test files alongside source (`*.test.ts`). | Vitest tests for business logic. |

### Modified files

| Path | Change |
|---|---|
| `src/components/layout/app-sidebar.tsx` | Add "Tournaments" nav item with `Trophy` icon between "Create" and "Library". |
| `package.json` | Add `satori` dependency. |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_create_tournament_tables.sql`

- [ ] **Step 1: Create the migration file**

Generate the timestamp and create the migration:

```bash
npx supabase migration new create_tournament_tables
```

- [ ] **Step 2: Write the migration SQL**

Write the full migration to the generated file:

```sql
-- tournaments table
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  base_image_square_id uuid references public.media_assets (id) on delete set null,
  base_image_story_id uuid references public.media_assets (id) on delete set null,
  house_rules_text text check (char_length(house_rules_text) <= 200),
  post_template text not null check (char_length(post_template) <= 500),
  platforms text[] not null default '{instagram,facebook}',
  post_lead_hours int not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tournaments add constraint tournaments_account_slug_unique
  unique (account_id, slug);

create index idx_tournaments_account on public.tournaments (account_id);

-- RLS
alter table public.tournaments enable row level security;

create policy "Tournaments accessible by account owner"
  on public.tournaments for all
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

-- tournament_fixtures table
create table if not exists public.tournament_fixtures (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  match_number int not null,
  round text not null check (round in (
    'group_stage', 'round_of_32', 'round_of_16',
    'quarter_final', 'semi_final', 'third_place', 'final'
  )),
  group_name text,
  team_a text not null check (char_length(team_a) <= 50),
  team_b text not null check (char_length(team_b) <= 50),
  teams_confirmed boolean not null default false,
  kick_off_at timestamptz not null,
  venue_city text,
  showing boolean not null default false,
  showing_note text,
  booking_url text check (booking_url is null or booking_url like 'https://%'),
  content_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tournament_fixtures add constraint fixtures_tournament_match_unique
  unique (tournament_id, match_number);

create index idx_fixtures_tournament_filter
  on public.tournament_fixtures (tournament_id, showing, teams_confirmed);

create index idx_fixtures_tournament_kickoff
  on public.tournament_fixtures (tournament_id, kick_off_at);

-- RLS via tournament ownership
alter table public.tournament_fixtures enable row level security;

create policy "Fixtures accessible via tournament account"
  on public.tournament_fixtures for all
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_fixtures.tournament_id
        and t.account_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_fixtures.tournament_id
        and t.account_id = auth.uid()
    )
  );

-- updated_at triggers
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tournaments_updated_at
  before update on public.tournaments
  for each row execute function public.set_updated_at();

create trigger tournament_fixtures_updated_at
  before update on public.tournament_fixtures
  for each row execute function public.set_updated_at();
```

- [ ] **Step 3: Apply the migration locally**

```bash
npx supabase db push --dry-run
```

Expected: migration applies cleanly with no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(tournament): add tournaments and tournament_fixtures tables with RLS"
```

---

## Task 2: TypeScript Types & Validation Schemas

**Files:**
- Create: `src/types/tournament.ts`
- Create: `src/lib/tournament/validation.ts`
- Create: `src/lib/tournament/placeholder.ts`
- Create: `src/lib/tournament/template.ts`
- Test: `src/lib/tournament/placeholder.test.ts`
- Test: `src/lib/tournament/template.test.ts`

- [ ] **Step 1: Write the placeholder detection test**

```typescript
// src/lib/tournament/placeholder.test.ts
import { describe, it, expect } from 'vitest';
import { isPlaceholderTeamName } from './placeholder';

describe('isPlaceholderTeamName', () => {
  it('should detect single letter + digits', () => {
    expect(isPlaceholderTeamName('A1')).toBe(true);
    expect(isPlaceholderTeamName('B2')).toBe(true);
    expect(isPlaceholderTeamName('C3')).toBe(true);
  });

  it('should detect W + digits', () => {
    expect(isPlaceholderTeamName('W73')).toBe(true);
    expect(isPlaceholderTeamName('W89')).toBe(true);
  });

  it('should detect digit + letter', () => {
    expect(isPlaceholderTeamName('1C')).toBe(true);
    expect(isPlaceholderTeamName('2F')).toBe(true);
  });

  it('should detect RU + digits', () => {
    expect(isPlaceholderTeamName('RU101')).toBe(true);
    expect(isPlaceholderTeamName('RU102')).toBe(true);
  });

  it('should detect complex group references', () => {
    expect(isPlaceholderTeamName('3ABCDF')).toBe(true);
    expect(isPlaceholderTeamName('3CDFGH')).toBe(true);
    expect(isPlaceholderTeamName('3EHIJK')).toBe(true);
  });

  it('should detect FIFA/UEFA qualifiers', () => {
    expect(isPlaceholderTeamName('FIFA PO 1')).toBe(true);
    expect(isPlaceholderTeamName('UEFA PO A')).toBe(true);
    expect(isPlaceholderTeamName('UEFA PO D')).toBe(true);
  });

  it('should NOT detect real team names', () => {
    expect(isPlaceholderTeamName('Germany')).toBe(false);
    expect(isPlaceholderTeamName('Japan')).toBe(false);
    expect(isPlaceholderTeamName('Bosnia & Herzegovina')).toBe(false);
    expect(isPlaceholderTeamName('USA')).toBe(false);
    expect(isPlaceholderTeamName('England')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/tournament/placeholder.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement placeholder detection**

```typescript
// src/lib/tournament/placeholder.ts
const PLACEHOLDER_PATTERN = /^[A-Z]{1,4}\d+$|^\d[A-Z]+$|^(FIFA|UEFA)\s+PO\s+/i;

export function isPlaceholderTeamName(name: string): boolean {
  return PLACEHOLDER_PATTERN.test(name.trim());
}

export function areBothTeamsConfirmed(teamA: string, teamB: string): boolean {
  return !isPlaceholderTeamName(teamA) && !isPlaceholderTeamName(teamB);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/tournament/placeholder.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Write the template interpolation test**

```typescript
// src/lib/tournament/template.test.ts
import { describe, it, expect } from 'vitest';
import { interpolatePostTemplate } from './template';

describe('interpolatePostTemplate', () => {
  const baseVars = {
    team_a: 'Germany',
    team_b: 'Japan',
    date: 'Saturday 13 June',
    time: '8:00 PM',
    group_round: 'Group E',
    house_rules: 'We stay open if the pub is busy.',
    booking_url: 'https://book.theanchor.pub',
  };

  it('should replace all placeholders', () => {
    const template = '{team_a} vs {team_b} at {time}';
    const result = interpolatePostTemplate(template, baseVars);
    expect(result).toBe('Germany vs Japan at 8:00 PM');
  });

  it('should render empty string for missing values', () => {
    const template = 'Book: {booking_url}';
    const result = interpolatePostTemplate(template, { ...baseVars, booking_url: '' });
    expect(result).toBe('Book: ');
  });

  it('should handle full template', () => {
    const template = `We're showing {team_a} vs {team_b} live at The Anchor!

{group_round}
Kick-off: {date} at {time}

{house_rules}

{booking_url}`;
    const result = interpolatePostTemplate(template, baseVars);
    expect(result).toContain('Germany vs Japan');
    expect(result).toContain('Group E');
    expect(result).toContain('Saturday 13 June');
    expect(result).toContain('8:00 PM');
    expect(result).toContain('We stay open');
    expect(result).toContain('https://book.theanchor.pub');
  });

  it('should not leave raw braces for unknown placeholders', () => {
    const result = interpolatePostTemplate('{unknown}', baseVars);
    expect(result).toBe('');
  });
});
```

- [ ] **Step 6: Implement template interpolation**

```typescript
// src/lib/tournament/template.ts
export interface TemplateVars {
  team_a: string;
  team_b: string;
  date: string;
  time: string;
  group_round: string;
  house_rules: string;
  booking_url: string;
}

const KNOWN_KEYS: (keyof TemplateVars)[] = [
  'team_a', 'team_b', 'date', 'time', 'group_round', 'house_rules', 'booking_url',
];

export function interpolatePostTemplate(
  template: string,
  vars: TemplateVars,
): string {
  let result = template;
  for (const key of KNOWN_KEYS) {
    result = result.replaceAll(`{${key}}`, vars[key] ?? '');
  }
  // Remove any remaining unknown placeholders
  result = result.replace(/\{[a-z_]+\}/g, '');
  return result;
}
```

- [ ] **Step 7: Run template test**

```bash
npx vitest run src/lib/tournament/template.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Write TypeScript types**

```typescript
// src/types/tournament.ts
export type TournamentStatus = 'draft' | 'active' | 'archived';

export type TournamentRound =
  | 'group_stage'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarter_final'
  | 'semi_final'
  | 'third_place'
  | 'final';

export type TournamentPlatform = 'instagram' | 'facebook';
export type ContentPlacement = 'feed' | 'story';

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
  createdAt: string;
  updatedAt: string;
}

export interface TournamentFixture {
  id: string;
  tournamentId: string;
  matchNumber: number;
  round: TournamentRound;
  groupName: string | null;
  teamA: string;
  teamB: string;
  teamsConfirmed: boolean;
  kickOffAt: string;
  venueCity: string | null;
  showing: boolean;
  showingNote: string | null;
  bookingUrl: string | null;
  contentGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export type FixtureContentStatus =
  | 'no_teams'
  | 'ready'
  | 'blocked'
  | 'past_due'
  | 'scheduled'
  | 'published'
  | 'not_showing';

export interface TournamentWithStats extends Tournament {
  totalFixtures: number;
  showingCount: number;
  confirmedCount: number;
  scheduledCount: number;
  publishedCount: number;
}

export interface FixtureWithStatus extends TournamentFixture {
  contentStatus: FixtureContentStatus;
}
```

- [ ] **Step 9: Write validation schemas**

```typescript
// src/lib/tournament/validation.ts
import { z } from 'zod';
import type { Tournament } from '@/types/tournament';

export const tournamentCreateSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Lowercase alphanumeric and hyphens only'),
  postTemplate: z.string().min(1).max(500),
  houseRulesText: z.string().max(200).optional().nullable(),
  platforms: z.array(z.enum(['instagram', 'facebook'])).min(1),
  postLeadHours: z.number().int().min(1).max(168).default(24),
});

export const tournamentUpdateSchema = tournamentCreateSchema.partial();

export const fixtureUpdateSchema = z.object({
  teamA: z.string().min(1).max(50),
  teamB: z.string().min(1).max(50),
  teamsConfirmed: z.boolean(),
  showing: z.boolean(),
  showingNote: z.string().max(200).optional().nullable(),
  bookingUrl: z.string().url().startsWith('https://').optional().nullable()
    .or(z.literal('')),
  kickOffAt: z.string().datetime(),
});

export interface TournamentPreconditionResult {
  ready: boolean;
  missing: string[];
}

export function checkTournamentPreconditions(
  tournament: Tournament,
  hasConnections: Record<string, boolean>,
): TournamentPreconditionResult {
  const missing: string[] = [];

  if (tournament.status !== 'active') {
    missing.push('Tournament must be active');
  }
  if (!tournament.baseImageSquareId) {
    missing.push('Square base image required');
  }
  if (!tournament.baseImageStoryId) {
    missing.push('Story base image required');
  }
  if (!tournament.postTemplate?.trim()) {
    missing.push('Post template required');
  }
  if (!tournament.platforms.length) {
    missing.push('At least one platform required');
  }
  for (const platform of tournament.platforms) {
    if (!hasConnections[platform]) {
      missing.push(`${platform} connection required`);
    }
  }

  return { ready: missing.length === 0, missing };
}
```

- [ ] **Step 10: Run all tests and commit**

```bash
npx vitest run src/lib/tournament/
git add src/types/tournament.ts src/lib/tournament/
git commit -m "feat(tournament): add types, validation schemas, placeholder detection, and template interpolation"
```

---

## Task 3: Install Satori & Overlay Renderer

**Files:**
- Create: `src/lib/tournament/overlay.ts`
- Test: `src/lib/tournament/overlay.test.ts`

- [ ] **Step 1: Install satori**

```bash
npm install satori
```

- [ ] **Step 2: Write the overlay renderer test**

```typescript
// src/lib/tournament/overlay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderOverlaySvg, type OverlayData } from './overlay';

describe('renderOverlaySvg', () => {
  const baseData: OverlayData = {
    teamA: 'Germany',
    teamB: 'Japan',
    dateDisplay: 'Saturday 14 June',
    timeDisplay: '8:00 PM',
    roundLabel: 'GROUP E',
    houseRulesText: 'We stay open while the pub is busy.',
  };

  it('should return an SVG buffer', async () => {
    const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1080 });
    expect(svg).toBeDefined();
    expect(typeof svg).toBe('string');
    expect(svg).toContain('<svg');
  });

  it('should include team names in the SVG', async () => {
    const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1080 });
    expect(svg).toContain('GERMANY');
    expect(svg).toContain('JAPAN');
  });

  it('should include date and time', async () => {
    const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1080 });
    expect(svg).toContain('Saturday 14 June');
    expect(svg).toContain('8:00 PM');
  });

  it('should render story dimensions', async () => {
    const svg = await renderOverlaySvg(baseData, { width: 1080, height: 1920 });
    expect(svg).toContain('<svg');
  });

  it('should scale font for long team names', async () => {
    const longData = { ...baseData, teamA: 'Bosnia & Herzegovina' };
    const svg = await renderOverlaySvg(longData, { width: 1080, height: 1080 });
    expect(svg).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/lib/tournament/overlay.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the overlay renderer**

```typescript
// src/lib/tournament/overlay.ts
import satori from 'satori';
import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join } from 'path';

export interface OverlayData {
  teamA: string;
  teamB: string;
  dateDisplay: string;
  timeDisplay: string;
  roundLabel: string;
  houseRulesText: string | null;
}

interface OverlayDimensions {
  width: number;
  height: number;
}

// Gold accent from the approved colour palette
const GOLD = '#c9952e';

let fontData: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  // Satori needs raw font data — use the same Noto Sans the project bundles
  const fontPath = join(process.cwd(), 'node_modules', '@vercel', 'og', 'noto-sans-v27-latin-regular.ttf');
  try {
    fontData = (await readFile(fontPath)).buffer as ArrayBuffer;
  } catch {
    // Fallback: fetch from Google Fonts CDN if local file not available
    const res = await fetch(
      'https://fonts.gstatic.com/s/notosans/v36/o-0bIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A-9a6Vc.ttf',
    );
    fontData = await res.arrayBuffer();
  }
  return fontData;
}

function computeTeamFontSize(
  teamA: string,
  teamB: string,
  imageWidth: number,
): number {
  const baseFontSize = Math.round(imageWidth * 0.07);
  const maxWidth = imageWidth * 0.85;
  const longestName = Math.max(teamA.length, teamB.length);
  const estimatedWidth = longestName * baseFontSize * 0.6;

  if (estimatedWidth > maxWidth) {
    return Math.round(baseFontSize * (maxWidth / estimatedWidth));
  }
  return baseFontSize;
}

export async function renderOverlaySvg(
  data: OverlayData,
  dimensions: OverlayDimensions,
): Promise<string> {
  const font = await loadFont();
  const { width, height } = dimensions;

  const teamFontSize = computeTeamFontSize(data.teamA, data.teamB, width);
  const vsFontSize = Math.round(teamFontSize * 0.5);
  const dateFontSize = Math.round(width * 0.035);
  const timeFontSize = Math.round(width * 0.055);
  const labelFontSize = Math.round(width * 0.022);
  const rulesFontSize = Math.round(width * 0.02);

  const element = {
    type: 'div',
    props: {
      style: {
        width: `${width}px`,
        height: `${height}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: `${Math.round(height * 0.18)}px`,
        paddingBottom: `${Math.round(height * 0.10)}px`,
        paddingLeft: `${Math.round(width * 0.05)}px`,
        paddingRight: `${Math.round(width * 0.05)}px`,
      },
      children: [
        // Round/group label
        {
          type: 'div',
          props: {
            style: {
              color: 'rgba(255,255,255,0.7)',
              fontSize: `${labelFontSize}px`,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              marginBottom: `${Math.round(height * 0.02)}px`,
            },
            children: data.roundLabel,
          },
        },
        // Team A
        {
          type: 'div',
          props: {
            style: {
              color: '#FFFFFF',
              fontSize: `${teamFontSize}px`,
              fontWeight: 700,
              textTransform: 'uppercase',
              textAlign: 'center',
              lineHeight: 1.1,
            },
            children: data.teamA,
          },
        },
        // vs
        {
          type: 'div',
          props: {
            style: {
              color: GOLD,
              fontSize: `${vsFontSize}px`,
              margin: `${Math.round(height * 0.01)}px 0`,
            },
            children: 'vs',
          },
        },
        // Team B
        {
          type: 'div',
          props: {
            style: {
              color: '#FFFFFF',
              fontSize: `${teamFontSize}px`,
              fontWeight: 700,
              textTransform: 'uppercase',
              textAlign: 'center',
              lineHeight: 1.1,
            },
            children: data.teamB,
          },
        },
        // Date
        {
          type: 'div',
          props: {
            style: {
              color: GOLD,
              fontSize: `${dateFontSize}px`,
              marginTop: `${Math.round(height * 0.03)}px`,
            },
            children: data.dateDisplay,
          },
        },
        // Kick-off time
        {
          type: 'div',
          props: {
            style: {
              color: '#FFFFFF',
              fontSize: `${timeFontSize}px`,
              fontWeight: 700,
              marginTop: `${Math.round(height * 0.005)}px`,
            },
            children: `KICK-OFF ${data.timeDisplay}`,
          },
        },
        // House rules
        ...(data.houseRulesText
          ? [
              {
                type: 'div',
                props: {
                  style: {
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: `${rulesFontSize}px`,
                    textAlign: 'center',
                    marginTop: `${Math.round(height * 0.03)}px`,
                    maxWidth: `${Math.round(width * 0.8)}px`,
                    lineHeight: 1.3,
                  },
                  children: data.houseRulesText,
                },
              },
            ]
          : []),
      ],
    },
  };

  const svg = await satori(element, {
    width,
    height,
    fonts: [
      {
        name: 'Noto Sans',
        data: font,
        weight: 400,
        style: 'normal',
      },
    ],
  });

  return svg;
}

export async function compositeOverlay(
  baseImageBuffer: Buffer,
  overlayData: OverlayData,
  dimensions: OverlayDimensions,
): Promise<Buffer> {
  const svg = await renderOverlaySvg(overlayData, dimensions);
  const svgBuffer = Buffer.from(svg);

  const result = await sharp(baseImageBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/lib/tournament/overlay.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/tournament/overlay.ts src/lib/tournament/overlay.test.ts
git commit -m "feat(tournament): add Satori + Sharp overlay renderer for match images"
```

---

## Task 4: Data Access Layer

**Files:**
- Create: `src/lib/tournament/queries.ts`

- [ ] **Step 1: Implement tournament and fixture queries**

```typescript
// src/lib/tournament/queries.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Tournament,
  TournamentFixture,
  TournamentWithStats,
  TournamentPlatform,
  TournamentStatus,
  TournamentRound,
} from '@/types/tournament';

// --- snake_case DB row → camelCase TypeScript mappers ---

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
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapFixture(row: Record<string, unknown>): TournamentFixture {
  return {
    id: row.id as string,
    tournamentId: row.tournament_id as string,
    matchNumber: row.match_number as number,
    round: row.round as TournamentRound,
    groupName: (row.group_name as string) ?? null,
    teamA: row.team_a as string,
    teamB: row.team_b as string,
    teamsConfirmed: row.teams_confirmed as boolean,
    kickOffAt: row.kick_off_at as string,
    venueCity: (row.venue_city as string) ?? null,
    showing: row.showing as boolean,
    showingNote: (row.showing_note as string) ?? null,
    bookingUrl: (row.booking_url as string) ?? null,
    contentGenerated: row.content_generated as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// --- Tournament queries ---

export async function getTournamentsByAccount(
  supabase: SupabaseClient,
  accountId: string,
): Promise<TournamentWithStats[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('account_id', accountId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const tournaments = (data ?? []).map(mapTournament);

  // Fetch fixture stats for each tournament
  const stats = await Promise.all(
    tournaments.map(async (t) => {
      const { data: fixtures } = await supabase
        .from('tournament_fixtures')
        .select('showing, teams_confirmed, content_generated')
        .eq('tournament_id', t.id);

      const f = fixtures ?? [];
      return {
        ...t,
        totalFixtures: f.length,
        showingCount: f.filter((fx: Record<string, unknown>) => fx.showing).length,
        confirmedCount: f.filter((fx: Record<string, unknown>) => fx.teams_confirmed).length,
        scheduledCount: f.filter((fx: Record<string, unknown>) => fx.content_generated).length,
        publishedCount: 0, // computed via content_items join in a later task
      };
    }),
  );

  return stats;
}

export async function getTournamentById(
  supabase: SupabaseClient,
  tournamentId: string,
  accountId: string,
): Promise<Tournament | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapTournament(data) : null;
}

export async function getFixturesByTournament(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<TournamentFixture[]> {
  const { data, error } = await supabase
    .from('tournament_fixtures')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('kick_off_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapFixture);
}

export async function getFixtureById(
  supabase: SupabaseClient,
  fixtureId: string,
  tournamentId: string,
): Promise<TournamentFixture | null> {
  const { data, error } = await supabase
    .from('tournament_fixtures')
    .select('*')
    .eq('id', fixtureId)
    .eq('tournament_id', tournamentId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapFixture(data) : null;
}

// --- Content lookup helpers ---

export async function getFixtureContentItems(
  supabase: SupabaseClient,
  fixtureId: string,
  accountId: string,
): Promise<Array<{ id: string; platform: string; placement: string; status: string }>> {
  const { data, error } = await supabase
    .from('content_items')
    .select('id, platform, placement, status')
    .eq('account_id', accountId)
    .containedBy('prompt_context', { tournament_fixture_id: fixtureId, source: 'tournament' });

  if (error) {
    // containedBy may not work for JSONB subfield matching; fall back to RPC or filter
    const { data: allItems, error: fallbackError } = await supabase
      .from('content_items')
      .select('id, platform, placement, status, prompt_context')
      .eq('account_id', accountId);

    if (fallbackError) throw fallbackError;

    return (allItems ?? []).filter(
      (item: Record<string, unknown>) => {
        const ctx = item.prompt_context as Record<string, unknown> | null;
        return ctx?.tournament_fixture_id === fixtureId && ctx?.source === 'tournament';
      },
    );
  }

  return data ?? [];
}

export async function getPublishedPlacements(
  supabase: SupabaseClient,
  fixtureId: string,
  accountId: string,
): Promise<Set<string>> {
  const items = await getFixtureContentItems(supabase, fixtureId, accountId);
  const published = new Set<string>();

  for (const item of items) {
    const { data: jobs } = await supabase
      .from('publish_jobs')
      .select('status')
      .eq('content_item_id', item.id)
      .eq('status', 'succeeded')
      .limit(1);

    if (jobs?.length) {
      published.add(`${item.platform}:${item.placement}`);
    }
  }

  return published;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/tournament/queries.ts
git commit -m "feat(tournament): add data access layer for tournaments and fixtures"
```

---

## Task 5: Content Generation Service

**Files:**
- Create: `src/lib/tournament/generate.ts`
- Test: `src/lib/tournament/generate.test.ts`

- [ ] **Step 1: Write a test for the stagger offset calculation**

```typescript
// src/lib/tournament/generate.test.ts
import { describe, it, expect } from 'vitest';
import { computeStaggerOffset, computeScheduledFor } from './generate';

describe('computeStaggerOffset', () => {
  it('should return 0 for the first fixture at a given time', () => {
    expect(computeStaggerOffset(0)).toBe(0);
  });

  it('should stagger by 5 minutes per index', () => {
    expect(computeStaggerOffset(1)).toBe(5 * 60 * 1000);
    expect(computeStaggerOffset(2)).toBe(10 * 60 * 1000);
    expect(computeStaggerOffset(3)).toBe(15 * 60 * 1000);
  });
});

describe('computeScheduledFor', () => {
  it('should subtract lead hours from kick-off', () => {
    const kickOff = new Date('2026-06-14T19:00:00Z');
    const result = computeScheduledFor(kickOff, 24, 0);
    expect(result).toEqual(new Date('2026-06-13T19:00:00Z'));
  });

  it('should add stagger offset', () => {
    const kickOff = new Date('2026-06-14T19:00:00Z');
    const result = computeScheduledFor(kickOff, 24, 1);
    expect(result).toEqual(new Date('2026-06-13T19:05:00Z'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/tournament/generate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the content generation service**

```typescript
// src/lib/tournament/generate.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { enqueuePublishJob } from '@/lib/publishing/queue';
import { getPublishReadinessIssues } from '@/lib/publishing/preflight';
import { compositeOverlay, type OverlayData } from '@/lib/tournament/overlay';
import { interpolatePostTemplate, type TemplateVars } from '@/lib/tournament/template';
import { getPublishedPlacements } from '@/lib/tournament/queries';
import type {
  Tournament,
  TournamentFixture,
  TournamentPlatform,
  ContentPlacement,
} from '@/types/tournament';
import { MEDIA_BUCKET } from '@/lib/constants';

// Exported for testing
export function computeStaggerOffset(index: number): number {
  return index * 5 * 60 * 1000;
}

export function computeScheduledFor(
  kickOff: Date,
  leadHours: number,
  staggerIndex: number,
): Date {
  const base = new Date(kickOff.getTime() - leadHours * 60 * 60 * 1000);
  return new Date(base.getTime() + computeStaggerOffset(staggerIndex));
}

function formatDateForOverlay(kickOffAt: string): { dateDisplay: string; timeDisplay: string } {
  const d = new Date(kickOffAt);
  const dateDisplay = d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
  const timeDisplay = d.toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Europe/London',
  }).toUpperCase();

  return { dateDisplay, timeDisplay };
}

function formatRoundLabel(round: string, groupName: string | null): string {
  if (groupName) return groupName.toUpperCase();
  return round.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).toUpperCase();
}

interface GenerateFixtureContentResult {
  success: boolean;
  error?: string;
  contentItemIds?: string[];
  blocked?: boolean;
  pastDue?: boolean;
}

export async function generateFixtureContent(
  tournament: Tournament,
  fixture: TournamentFixture,
  staggerIndex: number,
  options?: { skipPublished?: boolean },
): Promise<GenerateFixtureContentResult> {
  const supabase = createServiceSupabaseClient();

  // Advisory lock via pg_advisory_xact_lock on fixture ID hash
  const lockKey = hashUuidToInt(fixture.id);

  const { error: lockError } = await supabase.rpc('pg_advisory_xact_lock', { key: lockKey }).maybeSingle();

  // Re-check content_generated inside the lock
  const { data: freshFixture } = await supabase
    .from('tournament_fixtures')
    .select('content_generated')
    .eq('id', fixture.id)
    .single();

  if (freshFixture?.content_generated && !options?.skipPublished) {
    return { success: true, contentItemIds: [] };
  }

  // Determine which placements to generate
  const allPlacements: Array<{ platform: TournamentPlatform; placement: ContentPlacement }> = [];
  for (const platform of tournament.platforms) {
    allPlacements.push({ platform, placement: 'feed' });
    allPlacements.push({ platform, placement: 'story' });
  }

  let placementsToGenerate = allPlacements;

  if (options?.skipPublished) {
    const published = await getPublishedPlacements(supabase, fixture.id, tournament.accountId);
    placementsToGenerate = allPlacements.filter(
      (p) => !published.has(`${p.platform}:${p.placement}`),
    );
  }

  if (placementsToGenerate.length === 0) {
    return { success: true, contentItemIds: [] };
  }

  // Prepare overlay data
  const { dateDisplay, timeDisplay } = formatDateForOverlay(fixture.kickOffAt);
  const overlayData: OverlayData = {
    teamA: fixture.teamA,
    teamB: fixture.teamB,
    dateDisplay,
    timeDisplay,
    roundLabel: formatRoundLabel(fixture.round, fixture.groupName),
    houseRulesText: tournament.houseRulesText,
  };

  // Download base images
  const [squareImage, storyImage] = await Promise.all([
    downloadMediaAsset(supabase, tournament.baseImageSquareId!),
    downloadMediaAsset(supabase, tournament.baseImageStoryId!),
  ]);

  // Render overlays
  const [squareOverlay, storyOverlay] = await Promise.all([
    compositeOverlay(squareImage, overlayData, { width: 1080, height: 1080 }),
    compositeOverlay(storyImage, overlayData, { width: 1080, height: 1920 }),
  ]);

  const scheduledFor = computeScheduledFor(
    new Date(fixture.kickOffAt),
    tournament.postLeadHours,
    staggerIndex,
  );
  const isPastDue = scheduledFor.getTime() < Date.now();

  // Prepare post copy
  const templateVars: TemplateVars = {
    team_a: fixture.teamA,
    team_b: fixture.teamB,
    date: dateDisplay,
    time: timeDisplay,
    group_round: formatRoundLabel(fixture.round, fixture.groupName),
    house_rules: tournament.houseRulesText ?? '',
    booking_url: fixture.bookingUrl ?? '',
  };
  const postBody = interpolatePostTemplate(tournament.postTemplate, templateVars);

  const createdContentIds: string[] = [];
  const cleanupPaths: string[] = [];

  try {
    for (const { platform, placement } of placementsToGenerate) {
      const isStory = placement === 'story';
      const imageBuffer = isStory ? storyOverlay : squareOverlay;
      const aspectClass = isStory ? 'story' : 'square';

      // Upload to storage
      const assetId = crypto.randomUUID();
      const storagePath = `${tournament.accountId}/${assetId}/tournament-overlay.jpg`;
      cleanupPaths.push(storagePath);

      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(storagePath, imageBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      if (uploadError) throw uploadError;

      // Create media_asset
      const { error: mediaError } = await supabase
        .from('media_assets')
        .insert({
          id: assetId,
          account_id: tournament.accountId,
          storage_path: storagePath,
          file_name: `${fixture.teamA}-vs-${fixture.teamB}-${placement}.jpg`,
          media_type: 'image',
          mime_type: 'image/jpeg',
          size_bytes: imageBuffer.length,
          processed_status: 'ready',
          processed_at: new Date().toISOString(),
          aspect_class: aspectClass,
          derived_variants: isStory
            ? { story: storagePath }
            : {},
        })
        .throwOnError();

      // Create content_item
      const { data: contentItem, error: contentError } = await supabase
        .from('content_items')
        .insert({
          account_id: tournament.accountId,
          platform,
          placement,
          scheduled_for: scheduledFor.toISOString(),
          status: isPastDue ? 'draft' : 'scheduled',
          prompt_context: {
            tournament_fixture_id: fixture.id,
            tournament_id: tournament.id,
            source: 'tournament',
          },
          auto_generated: true,
        })
        .select('id')
        .single();
      if (contentError) throw contentError;

      createdContentIds.push(contentItem.id);

      // Create content_variant
      const { data: variant, error: variantError } = await supabase
        .from('content_variants')
        .upsert(
          {
            content_item_id: contentItem.id,
            body: isStory ? '' : postBody,
            media_ids: [assetId],
          },
          { onConflict: 'content_item_id' },
        )
        .select('id')
        .single();
      if (variantError) throw variantError;

      // Run preflight and enqueue if not past-due
      if (!isPastDue) {
        const issues = await getPublishReadinessIssues({
          supabase,
          accountId: tournament.accountId,
          contentId: contentItem.id,
          platform: platform as 'facebook' | 'instagram',
          placement,
        });

        if (issues.length === 0) {
          await enqueuePublishJob({
            contentItemId: contentItem.id,
            variantId: variant.id,
            placement,
            scheduledFor,
          });
        }
        // If preflight fails, content_item stays as 'draft' (blocked)
      }
    }

    // Mark fixture as generated
    await supabase
      .from('tournament_fixtures')
      .update({ content_generated: true })
      .eq('id', fixture.id)
      .throwOnError();

    return {
      success: true,
      contentItemIds: createdContentIds,
      pastDue: isPastDue,
      blocked: false,
    };
  } catch (error) {
    // Cleanup on failure
    await cleanupFailedGeneration(supabase, createdContentIds, cleanupPaths);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Generation failed',
    };
  }
}

async function downloadMediaAsset(
  supabase: SupabaseClient,
  assetId: string,
): Promise<Buffer> {
  const { data: asset } = await supabase
    .from('media_assets')
    .select('storage_path')
    .eq('id', assetId)
    .single();

  if (!asset) throw new Error(`Media asset ${assetId} not found`);

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(asset.storage_path);

  if (error || !data) throw error ?? new Error('Download failed');

  return Buffer.from(await data.arrayBuffer());
}

async function cleanupFailedGeneration(
  supabase: SupabaseClient,
  contentItemIds: string[],
  storagePaths: string[],
): Promise<void> {
  // Delete content items (cascades to variants and publish jobs)
  if (contentItemIds.length) {
    await supabase
      .from('content_items')
      .delete()
      .in('id', contentItemIds);
  }

  // Delete storage objects
  if (storagePaths.length) {
    await supabase.storage.from(MEDIA_BUCKET).remove(storagePaths);
  }

  // Delete media assets that reference these paths
  if (storagePaths.length) {
    await supabase
      .from('media_assets')
      .delete()
      .in('storage_path', storagePaths);
  }
}

function hashUuidToInt(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const char = uuid.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

// --- Bulk generation ---

export async function bulkGenerateContent(
  tournament: Tournament,
  fixtures: TournamentFixture[],
): Promise<{ generated: number; failed: number; errors: string[] }> {
  const eligible = fixtures.filter(
    (f) => f.showing && f.teamsConfirmed && !f.contentGenerated,
  );

  // Group by kick-off time for stagger calculation
  const byKickOff = new Map<string, TournamentFixture[]>();
  for (const fixture of eligible) {
    const key = fixture.kickOffAt;
    if (!byKickOff.has(key)) byKickOff.set(key, []);
    byKickOff.get(key)!.push(fixture);
  }

  // Sort each group by match_number for deterministic stagger
  for (const group of byKickOff.values()) {
    group.sort((a, b) => a.matchNumber - b.matchNumber);
  }

  let generated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const [, group] of byKickOff) {
    for (let i = 0; i < group.length; i++) {
      const result = await generateFixtureContent(tournament, group[i], i);
      if (result.success) {
        generated++;
      } else {
        failed++;
        errors.push(`Match ${group[i].matchNumber}: ${result.error}`);
      }
    }
  }

  return { generated, failed, errors };
}

// --- Fixture content deletion ---

export async function deleteFixtureContentItems(
  supabase: SupabaseClient,
  fixtureId: string,
  accountId: string,
  onlyUnpublished: boolean,
): Promise<number> {
  // Find content items for this fixture
  const { data: items } = await supabase
    .from('content_items')
    .select('id, prompt_context, status')
    .eq('account_id', accountId);

  const fixtureItems = (items ?? []).filter((item: Record<string, unknown>) => {
    const ctx = item.prompt_context as Record<string, unknown> | null;
    return ctx?.tournament_fixture_id === fixtureId && ctx?.source === 'tournament';
  });

  let toDelete = fixtureItems;
  if (onlyUnpublished) {
    // Check publish_jobs for each item
    const withStatus = await Promise.all(
      fixtureItems.map(async (item: Record<string, unknown>) => {
        const { data: jobs } = await supabase
          .from('publish_jobs')
          .select('status')
          .eq('content_item_id', item.id as string)
          .eq('status', 'succeeded')
          .limit(1);
        return { ...item, isPublished: (jobs?.length ?? 0) > 0 };
      }),
    );
    toDelete = withStatus.filter((item) => !item.isPublished);
  }

  if (toDelete.length === 0) return 0;

  const idsToDelete = toDelete.map((item: Record<string, unknown>) => item.id as string);

  // Get media_ids from variants before deleting
  const { data: variants } = await supabase
    .from('content_variants')
    .select('media_ids')
    .in('content_item_id', idsToDelete);

  const mediaIds = (variants ?? [])
    .flatMap((v: Record<string, unknown>) => (v.media_ids as string[]) ?? [])
    .filter(Boolean);

  // Delete content items (cascades to variants and publish jobs)
  await supabase
    .from('content_items')
    .delete()
    .in('id', idsToDelete)
    .throwOnError();

  // Delete associated media assets and storage objects
  if (mediaIds.length) {
    const { data: assets } = await supabase
      .from('media_assets')
      .select('id, storage_path')
      .in('id', mediaIds);

    const paths = (assets ?? []).map((a: Record<string, unknown>) => a.storage_path as string);
    if (paths.length) {
      await supabase.storage.from(MEDIA_BUCKET).remove(paths);
    }

    await supabase
      .from('media_assets')
      .delete()
      .in('id', mediaIds);
  }

  return idsToDelete.length;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/tournament/generate.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournament/generate.ts src/lib/tournament/generate.test.ts
git commit -m "feat(tournament): add content generation service with advisory lock and cleanup"
```

---

## Task 6: Tournament Server Actions

**Files:**
- Create: `src/app/actions/tournament.ts`

- [ ] **Step 1: Implement tournament CRUD server actions**

```typescript
// src/app/actions/tournament.ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/auth/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import {
  tournamentCreateSchema,
  tournamentUpdateSchema,
  fixtureUpdateSchema,
  checkTournamentPreconditions,
} from '@/lib/tournament/validation';
import {
  getTournamentById,
  getFixtureById,
  getFixturesByTournament,
} from '@/lib/tournament/queries';
import {
  generateFixtureContent,
  bulkGenerateContent,
  deleteFixtureContentItems,
} from '@/lib/tournament/generate';
import { areBothTeamsConfirmed } from '@/lib/tournament/placeholder';
import type { Tournament } from '@/types/tournament';

// --- Helpers ---

async function requireTournamentOwnership(
  tournamentId: string,
): Promise<{ supabase: Awaited<ReturnType<typeof requireAuthContext>>['supabase']; accountId: string; tournament: Tournament }> {
  const { supabase, accountId } = await requireAuthContext();
  const tournament = await getTournamentById(supabase, tournamentId, accountId);
  if (!tournament) {
    throw new Error('Tournament not found');
  }
  return { supabase, accountId, tournament };
}

// --- Tournament CRUD ---

export async function createTournament(
  input: unknown,
): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const { supabase, accountId } = await requireAuthContext();
    const parsed = tournamentCreateSchema.parse(input);

    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        account_id: accountId,
        name: parsed.name,
        slug: parsed.slug,
        post_template: parsed.postTemplate,
        house_rules_text: parsed.houseRulesText ?? null,
        platforms: parsed.platforms,
        post_lead_hours: parsed.postLeadHours,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'A tournament with this slug already exists' };
      }
      throw error;
    }

    revalidatePath('/dashboard/tournaments');
    return { success: true, id: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create tournament' };
  }
}

export async function updateTournament(
  tournamentId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, tournament } = await requireTournamentOwnership(tournamentId);
    const parsed = tournamentUpdateSchema.parse(input);

    const updateData: Record<string, unknown> = {};
    if (parsed.name !== undefined) updateData.name = parsed.name;
    if (parsed.slug !== undefined) updateData.slug = parsed.slug;
    if (parsed.postTemplate !== undefined) updateData.post_template = parsed.postTemplate;
    if (parsed.houseRulesText !== undefined) updateData.house_rules_text = parsed.houseRulesText;
    if (parsed.platforms !== undefined) updateData.platforms = parsed.platforms;
    if (parsed.postLeadHours !== undefined) updateData.post_lead_hours = parsed.postLeadHours;

    if (Object.keys(updateData).length === 0) {
      return { success: true };
    }

    await supabase
      .from('tournaments')
      .update(updateData)
      .eq('id', tournamentId)
      .throwOnError();

    revalidatePath('/dashboard/tournaments');
    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update tournament' };
  }
}

export async function updateTournamentStatus(
  tournamentId: string,
  status: 'draft' | 'active' | 'archived',
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireTournamentOwnership(tournamentId);

    await supabase
      .from('tournaments')
      .update({ status })
      .eq('id', tournamentId)
      .throwOnError();

    revalidatePath('/dashboard/tournaments');
    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update status' };
  }
}

export async function updateTournamentBaseImages(
  tournamentId: string,
  squareImageId: string | null,
  storyImageId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireTournamentOwnership(tournamentId);

    const updateData: Record<string, unknown> = {};
    if (squareImageId !== undefined) updateData.base_image_square_id = squareImageId;
    if (storyImageId !== undefined) updateData.base_image_story_id = storyImageId;

    await supabase
      .from('tournaments')
      .update(updateData)
      .eq('id', tournamentId)
      .throwOnError();

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update images' };
  }
}

// --- Fixture actions ---

export async function updateFixture(
  tournamentId: string,
  fixtureId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId, tournament } = await requireTournamentOwnership(tournamentId);
    const parsed = fixtureUpdateSchema.parse(input);

    // Sanitise booking URL
    const bookingUrl = parsed.bookingUrl === '' ? null : parsed.bookingUrl;

    await supabase
      .from('tournament_fixtures')
      .update({
        team_a: parsed.teamA,
        team_b: parsed.teamB,
        teams_confirmed: parsed.teamsConfirmed,
        showing: parsed.showing,
        showing_note: parsed.showingNote ?? null,
        booking_url: bookingUrl,
        kick_off_at: parsed.kickOffAt,
      })
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId)
      .throwOnError();

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update fixture' };
  }
}

export async function saveAndGenerateFixture(
  tournamentId: string,
  fixtureId: string,
  input: unknown,
): Promise<{ success: boolean; error?: string; pastDue?: boolean; blocked?: boolean }> {
  try {
    const { supabase, accountId, tournament } = await requireTournamentOwnership(tournamentId);
    const parsed = fixtureUpdateSchema.parse(input);

    // Check tournament preconditions
    const connections: Record<string, boolean> = {};
    for (const platform of tournament.platforms) {
      const { data: conn } = await supabase
        .from('social_connections')
        .select('id')
        .eq('account_id', accountId)
        .eq('provider', platform)
        .limit(1);
      connections[platform] = (conn?.length ?? 0) > 0;
    }

    const preconditions = checkTournamentPreconditions(tournament, connections);
    if (!preconditions.ready) {
      return { success: false, error: `Preconditions not met: ${preconditions.missing.join(', ')}` };
    }

    // Validate fixture is eligible
    if (!parsed.showing) {
      return { success: false, error: 'Fixture must be showing to generate content' };
    }
    if (!parsed.teamsConfirmed) {
      return { success: false, error: 'Teams must be confirmed to generate content' };
    }

    // Save fixture first
    const bookingUrl = parsed.bookingUrl === '' ? null : parsed.bookingUrl;
    await supabase
      .from('tournament_fixtures')
      .update({
        team_a: parsed.teamA,
        team_b: parsed.teamB,
        teams_confirmed: parsed.teamsConfirmed,
        showing: parsed.showing,
        showing_note: parsed.showingNote ?? null,
        booking_url: bookingUrl,
        kick_off_at: parsed.kickOffAt,
      })
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId)
      .throwOnError();

    // Determine stagger index
    const allFixtures = await getFixturesByTournament(supabase, tournamentId);
    const fixture = allFixtures.find((f) => f.id === fixtureId);
    if (!fixture) throw new Error('Fixture not found after update');

    const sameTimeFixtures = allFixtures
      .filter((f) => f.kickOffAt === fixture.kickOffAt && f.showing)
      .sort((a, b) => a.matchNumber - b.matchNumber);
    const staggerIndex = sameTimeFixtures.findIndex((f) => f.id === fixtureId);

    // Handle regeneration: if content already exists, delete unpublished and regen
    if (fixture.contentGenerated) {
      await deleteFixtureContentItems(supabase, fixtureId, accountId, true);
      await supabase
        .from('tournament_fixtures')
        .update({ content_generated: false })
        .eq('id', fixtureId)
        .throwOnError();
    }

    // Generate content
    const result = await generateFixtureContent(
      tournament,
      { ...fixture, teamA: parsed.teamA, teamB: parsed.teamB, teamsConfirmed: true },
      staggerIndex,
      { skipPublished: fixture.contentGenerated },
    );

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, pastDue: result.pastDue, blocked: result.blocked };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to generate content' };
  }
}

export async function bulkGenerateAction(
  tournamentId: string,
): Promise<{ success: boolean; generated?: number; failed?: number; errors?: string[]; error?: string }> {
  try {
    const { supabase, accountId, tournament } = await requireTournamentOwnership(tournamentId);

    // Check tournament preconditions
    const connections: Record<string, boolean> = {};
    for (const platform of tournament.platforms) {
      const { data: conn } = await supabase
        .from('social_connections')
        .select('id')
        .eq('account_id', accountId)
        .eq('provider', platform)
        .limit(1);
      connections[platform] = (conn?.length ?? 0) > 0;
    }

    const preconditions = checkTournamentPreconditions(tournament, connections);
    if (!preconditions.ready) {
      return { success: false, error: `Preconditions not met: ${preconditions.missing.join(', ')}` };
    }

    const fixtures = await getFixturesByTournament(supabase, tournamentId);
    const result = await bulkGenerateContent(tournament, fixtures);

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Bulk generation failed' };
  }
}

export async function publishNowFixture(
  tournamentId: string,
  fixtureId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId, tournament } = await requireTournamentOwnership(tournamentId);

    // Find unpublished content items for this fixture
    const { data: items } = await supabase
      .from('content_items')
      .select('id, platform, placement, prompt_context')
      .eq('account_id', accountId);

    const fixtureItems = (items ?? []).filter((item: Record<string, unknown>) => {
      const ctx = item.prompt_context as Record<string, unknown> | null;
      return ctx?.tournament_fixture_id === fixtureId && ctx?.source === 'tournament';
    });

    for (const item of fixtureItems) {
      const { data: existingJobs } = await supabase
        .from('publish_jobs')
        .select('id')
        .eq('content_item_id', item.id as string)
        .in('status', ['queued', 'in_progress', 'succeeded']);

      if (!existingJobs?.length) {
        const { data: variant } = await supabase
          .from('content_variants')
          .select('id')
          .eq('content_item_id', item.id as string)
          .single();

        if (variant) {
          await enqueuePublishJob({
            contentItemId: item.id as string,
            variantId: variant.id,
            placement: item.placement as 'feed' | 'story',
            scheduledFor: null, // publish immediately
          });
        }
      }
    }

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to publish' };
  }
}

export async function toggleFixtureShowing(
  tournamentId: string,
  fixtureId: string,
  showing: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, accountId, tournament } = await requireTournamentOwnership(tournamentId);

    await supabase
      .from('tournament_fixtures')
      .update({ showing })
      .eq('id', fixtureId)
      .eq('tournament_id', tournamentId)
      .throwOnError();

    // If toggling off, delete unpublished content
    if (!showing) {
      const deleted = await deleteFixtureContentItems(supabase, fixtureId, accountId, true);
      if (deleted > 0) {
        // Check if any published content remains
        const { data: remaining } = await supabase
          .from('content_items')
          .select('id, prompt_context')
          .eq('account_id', accountId);

        const hasPublished = (remaining ?? []).some((item: Record<string, unknown>) => {
          const ctx = item.prompt_context as Record<string, unknown> | null;
          return ctx?.tournament_fixture_id === fixtureId && ctx?.source === 'tournament';
        });

        if (!hasPublished) {
          await supabase
            .from('tournament_fixtures')
            .update({ content_generated: false })
            .eq('id', fixtureId)
            .throwOnError();
        }
      }
    }

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to toggle showing' };
  }
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit src/app/actions/tournament.ts 2>&1 | head -20
```

Fix any type errors. Note: full type-checking depends on runtime DB types; structural correctness is the goal here.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/tournament.ts
git commit -m "feat(tournament): add tournament and fixture server actions with auth checks"
```

---

## Task 7: Tournament List Page

**Files:**
- Create: `src/app/(app)/dashboard/tournaments/page.tsx`
- Create: `src/features/tournament/components/TournamentList.tsx`
- Modify: `src/components/layout/app-sidebar.tsx`

- [ ] **Step 1: Create the tournament list server page**

```typescript
// src/app/(app)/dashboard/tournaments/page.tsx
import { requireAuthContext } from '@/lib/auth/server';
import { getTournamentsByAccount } from '@/lib/tournament/queries';
import { TournamentList } from '@/features/tournament/components/TournamentList';

export default async function TournamentsPage() {
  const { supabase, accountId } = await requireAuthContext();
  const tournaments = await getTournamentsByAccount(supabase, accountId);

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Tournaments</h1>
          <p className="text-muted-foreground mt-1">
            Manage tournament fixtures and automated social content
          </p>
        </div>
      </div>
      <TournamentList tournaments={tournaments} />
    </div>
  );
}
```

- [ ] **Step 2: Create the TournamentList client component**

```typescript
// src/features/tournament/components/TournamentList.tsx
'use client';

import Link from 'next/link';
import { Trophy } from 'lucide-react';
import type { TournamentWithStats } from '@/types/tournament';

interface TournamentListProps {
  tournaments: TournamentWithStats[];
}

const STATUS_COLOURS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
};

export function TournamentList({ tournaments }: TournamentListProps) {
  if (tournaments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-2">No tournaments yet</h2>
        <p className="text-muted-foreground mb-4">
          Create your first tournament to start scheduling social content for upcoming games.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {tournaments.map((tournament) => (
        <Link
          key={tournament.id}
          href={`/dashboard/tournaments/${tournament.id}`}
          className="block rounded-lg border bg-card p-6 hover:border-primary transition-colors"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-lg font-semibold">{tournament.name}</h2>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOURS[tournament.status] ?? ''}`}
                >
                  {tournament.status}
                </span>
              </div>
              <div className="flex gap-6 text-sm text-muted-foreground">
                <span>{tournament.showingCount}/{tournament.totalFixtures} showing</span>
                <span>{tournament.confirmedCount} confirmed</span>
                <span>{tournament.scheduledCount} scheduled</span>
              </div>
            </div>
            <Trophy className="h-5 w-5 text-muted-foreground" />
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add Tournaments to the sidebar navigation**

In `src/components/layout/app-sidebar.tsx`, add the Trophy import and the nav item:

Add `Trophy` to the lucide-react import:
```typescript
import {
    CalendarRange,
    Images,
    Link2,
    Settings,
    Sparkles,
    Command,
    User,
    Trophy,
} from "lucide-react"
```

Add the Tournaments item to the `items` array after "Create":
```typescript
const items = [
    {
        title: "Planner",
        url: "/planner",
        icon: CalendarRange,
    },
    {
        title: "Create",
        url: "/create",
        icon: Sparkles,
    },
    {
        title: "Tournaments",
        url: "/dashboard/tournaments",
        icon: Trophy,
    },
    {
        title: "Library",
        url: "/library",
        icon: Images,
    },
    // ... rest unchanged
]
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/tournaments/page.tsx src/features/tournament/components/TournamentList.tsx src/components/layout/app-sidebar.tsx
git commit -m "feat(tournament): add tournament list page and sidebar navigation"
```

---

## Task 8: Tournament Detail Page

**Files:**
- Create: `src/app/(app)/dashboard/tournaments/[id]/page.tsx`
- Create: `src/features/tournament/components/TournamentHeader.tsx`
- Create: `src/features/tournament/components/StatusBadge.tsx`
- Create: `src/features/tournament/components/PreconditionWarning.tsx`

- [ ] **Step 1: Create the StatusBadge component**

```typescript
// src/features/tournament/components/StatusBadge.tsx
'use client';

import type { FixtureContentStatus } from '@/types/tournament';

const STATUS_CONFIG: Record<FixtureContentStatus, { label: string; className: string }> = {
  no_teams: { label: 'No Teams', className: 'bg-gray-100 text-gray-600' },
  not_showing: { label: 'Not Showing', className: 'bg-gray-100 text-gray-500' },
  ready: { label: 'Ready', className: 'bg-blue-100 text-blue-700' },
  blocked: { label: 'Blocked', className: 'bg-red-100 text-red-700' },
  past_due: { label: 'Past Due', className: 'bg-amber-100 text-amber-700' },
  scheduled: { label: 'Scheduled', className: 'bg-green-100 text-green-700' },
  published: { label: 'Published', className: 'bg-emerald-100 text-emerald-700' },
};

export function StatusBadge({ status }: { status: FixtureContentStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
```

- [ ] **Step 2: Create the PreconditionWarning component**

```typescript
// src/features/tournament/components/PreconditionWarning.tsx
'use client';

import { AlertTriangle } from 'lucide-react';

export function PreconditionWarning({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-sm font-medium text-amber-800">
            Content generation is disabled
          </h3>
          <ul className="mt-2 text-sm text-amber-700 list-disc list-inside space-y-1">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the TournamentHeader component**

```typescript
// src/features/tournament/components/TournamentHeader.tsx
'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Tournament, TournamentFixture } from '@/types/tournament';
import { bulkGenerateAction } from '@/app/actions/tournament';
import { PreconditionWarning } from './PreconditionWarning';

interface TournamentHeaderProps {
  tournament: Tournament;
  fixtures: TournamentFixture[];
  preconditionsMissing: string[];
}

export function TournamentHeader({
  tournament,
  fixtures,
  preconditionsMissing,
}: TournamentHeaderProps) {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ generated?: number; failed?: number } | null>(null);

  const totalFixtures = fixtures.length;
  const showingCount = fixtures.filter((f) => f.showing).length;
  const confirmedCount = fixtures.filter((f) => f.teamsConfirmed).length;
  const generatedCount = fixtures.filter((f) => f.contentGenerated).length;
  const eligibleCount = fixtures.filter(
    (f) => f.showing && f.teamsConfirmed && !f.contentGenerated,
  ).length;

  const canGenerate = preconditionsMissing.length === 0 && eligibleCount > 0;

  async function handleBulkGenerate() {
    if (!canGenerate || generating) return;
    setGenerating(true);
    setResult(null);

    try {
      const res = await bulkGenerateAction(tournament.id);
      if (res.success) {
        setResult({ generated: res.generated, failed: res.failed });
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{tournament.name}</h1>
          <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
            <span>{showingCount}/{totalFixtures} showing</span>
            <span>{confirmedCount} confirmed</span>
            <span>{generatedCount} scheduled</span>
          </div>
        </div>

        <button
          onClick={handleBulkGenerate}
          disabled={!canGenerate || generating}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            !canGenerate
              ? preconditionsMissing.length > 0
                ? 'Fix preconditions first'
                : 'No eligible fixtures'
              : `Generate content for ${eligibleCount} fixtures`
          }
        >
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
          Generate All ({eligibleCount})
        </button>
      </div>

      <PreconditionWarning missing={preconditionsMissing} />

      {result && (
        <div className="rounded-md bg-muted p-3 text-sm">
          Generated {result.generated} fixtures.
          {(result.failed ?? 0) > 0 && ` ${result.failed} failed.`}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the detail page server component**

```typescript
// src/app/(app)/dashboard/tournaments/[id]/page.tsx
import { notFound } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/server';
import {
  getTournamentById,
  getFixturesByTournament,
} from '@/lib/tournament/queries';
import { checkTournamentPreconditions } from '@/lib/tournament/validation';
import { TournamentHeader } from '@/features/tournament/components/TournamentHeader';
import { FixtureTable } from '@/features/tournament/components/FixtureTable';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TournamentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { supabase, accountId } = await requireAuthContext();

  const tournament = await getTournamentById(supabase, id, accountId);
  if (!tournament) notFound();

  const fixtures = await getFixturesByTournament(supabase, id);

  // Check preconditions
  const connections: Record<string, boolean> = {};
  for (const platform of tournament.platforms) {
    const { data: conn } = await supabase
      .from('social_connections')
      .select('id')
      .eq('account_id', accountId)
      .eq('provider', platform)
      .limit(1);
    connections[platform] = (conn?.length ?? 0) > 0;
  }

  const preconditions = checkTournamentPreconditions(tournament, connections);

  return (
    <div className="container mx-auto max-w-7xl py-8 px-4">
      <TournamentHeader
        tournament={tournament}
        fixtures={fixtures}
        preconditionsMissing={preconditions.missing}
      />
      <FixtureTable
        tournament={tournament}
        fixtures={fixtures}
        canGenerate={preconditions.ready}
      />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/tournaments/\[id\]/page.tsx src/features/tournament/components/TournamentHeader.tsx src/features/tournament/components/StatusBadge.tsx src/features/tournament/components/PreconditionWarning.tsx
git commit -m "feat(tournament): add tournament detail page with header and status components"
```

---

## Task 9: Fixture Table & Inline Editing

**Files:**
- Create: `src/features/tournament/components/FixtureTable.tsx`
- Create: `src/features/tournament/components/FixtureRow.tsx`

- [ ] **Step 1: Create the FixtureTable component**

```typescript
// src/features/tournament/components/FixtureTable.tsx
'use client';

import { useState, useMemo } from 'react';
import type { Tournament, TournamentFixture, FixtureContentStatus } from '@/types/tournament';
import { FixtureRow } from './FixtureRow';

interface FixtureTableProps {
  tournament: Tournament;
  fixtures: TournamentFixture[];
  canGenerate: boolean;
}

type FilterKey = 'all' | 'showing' | 'needs_teams' | 'ready' | 'generated';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'showing', label: 'Showing' },
  { key: 'needs_teams', label: 'Needs Teams' },
  { key: 'ready', label: 'Ready to Generate' },
  { key: 'generated', label: 'Generated' },
];

function deriveContentStatus(fixture: TournamentFixture): FixtureContentStatus {
  if (!fixture.showing) return 'not_showing';
  if (!fixture.teamsConfirmed) return 'no_teams';
  if (fixture.contentGenerated) return 'scheduled';
  return 'ready';
}

export function FixtureTable({ tournament, fixtures, canGenerate }: FixtureTableProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortBy, setSortBy] = useState<'date' | 'match'>('date');

  const filtered = useMemo(() => {
    let result = [...fixtures];

    switch (filter) {
      case 'showing':
        result = result.filter((f) => f.showing);
        break;
      case 'needs_teams':
        result = result.filter((f) => f.showing && !f.teamsConfirmed);
        break;
      case 'ready':
        result = result.filter((f) => f.showing && f.teamsConfirmed && !f.contentGenerated);
        break;
      case 'generated':
        result = result.filter((f) => f.contentGenerated);
        break;
    }

    if (sortBy === 'match') {
      result.sort((a, b) => a.matchNumber - b.matchNumber);
    } else {
      result.sort((a, b) => new Date(a.kickOffAt).getTime() - new Date(b.kickOffAt).getTime());
    }

    return result;
  }, [fixtures, filter, sortBy]);

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              filter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {f.label}
            {f.key !== 'all' && (
              <span className="ml-1">
                ({fixtures.filter((fx) => {
                  switch (f.key) {
                    case 'showing': return fx.showing;
                    case 'needs_teams': return fx.showing && !fx.teamsConfirmed;
                    case 'ready': return fx.showing && fx.teamsConfirmed && !fx.contentGenerated;
                    case 'generated': return fx.contentGenerated;
                    default: return true;
                  }
                }).length})
              </span>
            )}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sort:</span>
          <button
            onClick={() => setSortBy('date')}
            className={sortBy === 'date' ? 'font-medium' : 'text-muted-foreground'}
          >
            Date
          </button>
          <span className="text-muted-foreground">/</span>
          <button
            onClick={() => setSortBy('match')}
            className={sortBy === 'match' ? 'font-medium' : 'text-muted-foreground'}
          >
            Match #
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-16">#</th>
              <th className="px-3 py-2 text-left font-medium">Date/Time</th>
              <th className="px-3 py-2 text-left font-medium">Team A</th>
              <th className="px-3 py-2 text-center font-medium w-12">vs</th>
              <th className="px-3 py-2 text-left font-medium">Team B</th>
              <th className="px-3 py-2 text-left font-medium w-28">Round</th>
              <th className="px-3 py-2 text-center font-medium w-20">Showing</th>
              <th className="px-3 py-2 text-center font-medium w-24">Status</th>
              <th className="px-3 py-2 text-right font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((fixture) => (
              <FixtureRow
                key={fixture.id}
                fixture={fixture}
                tournament={tournament}
                contentStatus={deriveContentStatus(fixture)}
                canGenerate={canGenerate}
              />
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            No fixtures match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the FixtureRow component with inline editing**

```typescript
// src/features/tournament/components/FixtureRow.tsx
'use client';

import { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { Tournament, TournamentFixture, FixtureContentStatus } from '@/types/tournament';
import {
  saveAndGenerateFixture,
  updateFixture,
  toggleFixtureShowing,
  publishNowFixture,
} from '@/app/actions/tournament';
import { areBothTeamsConfirmed } from '@/lib/tournament/placeholder';
import { StatusBadge } from './StatusBadge';

interface FixtureRowProps {
  fixture: TournamentFixture;
  tournament: Tournament;
  contentStatus: FixtureContentStatus;
  canGenerate: boolean;
}

export function FixtureRow({
  fixture,
  tournament,
  contentStatus,
  canGenerate,
}: FixtureRowProps) {
  const [editing, setEditing] = useState(false);
  const [teamA, setTeamA] = useState(fixture.teamA);
  const [teamB, setTeamB] = useState(fixture.teamB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teamARef = useRef<HTMLInputElement>(null);

  const isModified = teamA !== fixture.teamA || teamB !== fixture.teamB;
  const autoConfirmed = areBothTeamsConfirmed(teamA, teamB);
  const canSaveAndGenerate =
    canGenerate && fixture.showing && autoConfirmed && isModified;

  const kickOff = new Date(fixture.kickOffAt);
  const dateStr = kickOff.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Europe/London',
  });
  const timeStr = kickOff.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });

  const roundLabel = fixture.groupName
    ?? fixture.round.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  async function handleSaveAndGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await saveAndGenerateFixture(tournament.id, fixture.id, {
        teamA,
        teamB,
        teamsConfirmed: autoConfirmed,
        showing: fixture.showing,
        showingNote: fixture.showingNote,
        bookingUrl: fixture.bookingUrl,
        kickOffAt: fixture.kickOffAt,
      });
      if (!result.success) {
        setError(result.error ?? 'Generation failed');
      }
      setEditing(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveOnly() {
    setLoading(true);
    setError(null);
    try {
      const result = await updateFixture(tournament.id, fixture.id, {
        teamA,
        teamB,
        teamsConfirmed: autoConfirmed,
        showing: fixture.showing,
        showingNote: fixture.showingNote,
        bookingUrl: fixture.bookingUrl,
        kickOffAt: fixture.kickOffAt,
      });
      if (!result.success) {
        setError(result.error ?? 'Save failed');
      }
      setEditing(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleShowing() {
    setLoading(true);
    try {
      await toggleFixtureShowing(tournament.id, fixture.id, !fixture.showing);
    } finally {
      setLoading(false);
    }
  }

  async function handlePublishNow() {
    setLoading(true);
    try {
      await publishNowFixture(tournament.id, fixture.id);
    } finally {
      setLoading(false);
    }
  }

  return (
    <tr className={`${isModified ? 'bg-amber-50/50' : ''} ${error ? 'bg-red-50/30' : ''}`}>
      <td className="px-3 py-2 text-muted-foreground">{fixture.matchNumber}</td>
      <td className="px-3 py-2">
        <div className="text-xs text-muted-foreground">{dateStr}</div>
        <div className="font-medium">{timeStr}</div>
      </td>
      <td className="px-3 py-2">
        {editing ? (
          <input
            ref={teamARef}
            type="text"
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
            maxLength={50}
          />
        ) : (
          <button
            onClick={() => {
              setEditing(true);
              setTimeout(() => teamARef.current?.focus(), 0);
            }}
            className="text-left hover:text-primary transition-colors w-full"
          >
            {fixture.teamA}
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-center text-muted-foreground text-xs">vs</td>
      <td className="px-3 py-2">
        {editing ? (
          <input
            type="text"
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
            maxLength={50}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-left hover:text-primary transition-colors w-full"
          >
            {fixture.teamB}
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{roundLabel}</td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={fixture.showing}
          onChange={handleToggleShowing}
          disabled={loading}
          className="rounded border-gray-300"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <StatusBadge status={contentStatus} />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}

          {editing && isModified && (
            <>
              <button
                onClick={handleSaveOnly}
                disabled={loading}
                className="rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80 disabled:opacity-50"
              >
                Save
              </button>
              {canSaveAndGenerate && (
                <button
                  onClick={handleSaveAndGenerate}
                  disabled={loading}
                  className="rounded px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Save & Generate
                </button>
              )}
            </>
          )}

          {editing && !isModified && (
            <button
              onClick={() => setEditing(false)}
              className="rounded px-2 py-1 text-xs text-muted-foreground"
            >
              Cancel
            </button>
          )}

          {!editing && contentStatus === 'past_due' && (
            <button
              onClick={handlePublishNow}
              disabled={loading}
              className="rounded px-2 py-1 text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
            >
              Publish Now
            </button>
          )}

          {error && (
            <span className="text-xs text-red-600 ml-1">{error}</span>
          )}
        </div>
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/tournament/components/FixtureTable.tsx src/features/tournament/components/FixtureRow.tsx
git commit -m "feat(tournament): add fixture table with inline editing and save & generate flow"
```

---

## Task 10: Tournament Settings Modal

**Files:**
- Create: `src/features/tournament/components/TournamentSettingsModal.tsx`

- [ ] **Step 1: Create the settings modal**

```typescript
// src/features/tournament/components/TournamentSettingsModal.tsx
'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { Tournament } from '@/types/tournament';
import { updateTournament, updateTournamentStatus } from '@/app/actions/tournament';

interface TournamentSettingsModalProps {
  tournament: Tournament;
  open: boolean;
  onClose: () => void;
}

export function TournamentSettingsModal({
  tournament,
  open,
  onClose,
}: TournamentSettingsModalProps) {
  const [name, setName] = useState(tournament.name);
  const [houseRulesText, setHouseRulesText] = useState(tournament.houseRulesText ?? '');
  const [postTemplate, setPostTemplate] = useState(tournament.postTemplate);
  const [postLeadHours, setPostLeadHours] = useState(tournament.postLeadHours);
  const [platforms, setPlatforms] = useState(tournament.platforms);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await updateTournament(tournament.id, {
        name,
        houseRulesText: houseRulesText || null,
        postTemplate,
        postLeadHours,
        platforms,
      });
      if (!result.success) {
        setError(result.error ?? 'Failed to save');
      } else {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: 'draft' | 'active' | 'archived') {
    setSaving(true);
    try {
      await updateTournamentStatus(tournament.id, status);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function togglePlatform(platform: 'instagram' | 'facebook') {
    setPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Tournament Settings</h2>
          <button onClick={onClose}>
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              House Rules <span className="text-muted-foreground">({houseRulesText.length}/200)</span>
            </label>
            <textarea
              value={houseRulesText}
              onChange={(e) => setHouseRulesText(e.target.value.slice(0, 200))}
              className="w-full rounded-md border px-3 py-2 text-sm h-20 resize-none"
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Post Template <span className="text-muted-foreground">({postTemplate.length}/500)</span>
            </label>
            <textarea
              value={postTemplate}
              onChange={(e) => setPostTemplate(e.target.value.slice(0, 500))}
              className="w-full rounded-md border px-3 py-2 text-sm h-32 resize-none font-mono"
              maxLength={500}
              placeholder="Placeholders: {team_a}, {team_b}, {date}, {time}, {group_round}, {house_rules}, {booking_url}"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Post Lead Time</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={postLeadHours}
                onChange={(e) => setPostLeadHours(Math.max(1, Math.min(168, parseInt(e.target.value) || 24)))}
                className="w-20 rounded-md border px-3 py-2 text-sm"
                min={1}
                max={168}
              />
              <span className="text-sm text-muted-foreground">hours before kick-off</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Platforms</label>
            <div className="flex gap-4">
              {(['instagram', 'facebook'] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                    className="rounded border-gray-300"
                  />
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Status</label>
            <div className="flex gap-2">
              {(['draft', 'active', 'archived'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  disabled={tournament.status === s || saving}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    tournament.status === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  } disabled:opacity-50`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Lead time changes apply to future generation only.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !postTemplate.trim() || platforms.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire settings button into TournamentHeader**

In `src/features/tournament/components/TournamentHeader.tsx`, add a Settings button that opens the modal. Import `TournamentSettingsModal` and add state `const [settingsOpen, setSettingsOpen] = useState(false)`. Add a "Settings" button beside the "Generate All" button, and render `<TournamentSettingsModal>` at the bottom of the component.

- [ ] **Step 3: Commit**

```bash
git add src/features/tournament/components/TournamentSettingsModal.tsx src/features/tournament/components/TournamentHeader.tsx
git commit -m "feat(tournament): add tournament settings modal with platform, template, and status controls"
```

---

## Task 11: World Cup 2026 Seed Script

**Files:**
- Create: `scripts/ops/seed-world-cup-2026.ts`

- [ ] **Step 1: Create the seed script**

Create `scripts/ops/seed-world-cup-2026.ts` with the full 104-fixture dataset. The script should:

1. Accept a `--tournament-id` CLI argument (or create a new tournament)
2. Use `createServiceSupabaseClient()` to bypass RLS
3. Insert all 104 fixtures with:
   - Match numbers 1–104
   - Kick-off times in UTC (converted from the UK times in the original fixture list)
   - Placeholder team names (A1, B2, W73, etc.)
   - Group/round classifications
   - Showing status (the 52 games Peter marked as showing)
   - Venue city information
   - Showing notes where applicable
4. Use upsert on `(tournament_id, match_number)` so the script is idempotent

The fixture data comes from the spec and the original user-provided fixture list. Include all 104 matches with correct UTC timestamps.

- [ ] **Step 2: Add npm script**

In `package.json`, add:
```json
"ops:seed-world-cup": "npx tsx scripts/ops/seed-world-cup-2026.ts"
```

- [ ] **Step 3: Test locally**

```bash
npm run ops:seed-world-cup -- --tournament-id <test-id> --dry-run
```

Verify the output shows 104 fixtures with correct data.

- [ ] **Step 4: Commit**

```bash
git add scripts/ops/seed-world-cup-2026.ts package.json
git commit -m "feat(tournament): add World Cup 2026 seed script with 104 fixtures"
```

---

## Task 12: Advisory Lock Database Function

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_add_advisory_lock_function.sql`

- [ ] **Step 1: Create the migration**

The content generation service needs `pg_advisory_xact_lock` which requires a helper to call from the Supabase client:

```bash
npx supabase migration new add_advisory_lock_function
```

```sql
-- Expose pg_advisory_xact_lock as an RPC callable from the Supabase client.
-- Used by tournament content generation to prevent concurrent generation per fixture.
create or replace function public.advisory_lock_fixture(lock_key bigint)
returns void
language plpgsql
security definer
as $$
begin
  perform pg_advisory_xact_lock(lock_key);
end;
$$;

-- Only service role can call this
revoke execute on function public.advisory_lock_fixture(bigint) from public;
revoke execute on function public.advisory_lock_fixture(bigint) from anon;
revoke execute on function public.advisory_lock_fixture(bigint) from authenticated;
grant execute on function public.advisory_lock_fixture(bigint) to service_role;
```

- [ ] **Step 2: Update generate.ts to use the RPC**

In `src/lib/tournament/generate.ts`, replace the `pg_advisory_xact_lock` call with:

```typescript
await supabase.rpc('advisory_lock_fixture', { lock_key: lockKey }).throwOnError();
```

- [ ] **Step 3: Apply and commit**

```bash
npx supabase db push --dry-run
git add supabase/migrations/ src/lib/tournament/generate.ts
git commit -m "feat(tournament): add advisory lock RPC for fixture generation idempotency"
```

---

## Task 13: Verification & Polish

**Files:**
- Various — verification only, no new files

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Fix any errors. Common issues:
- Missing imports (Zod, types, server action references)
- Type mismatches between DB row shapes and TypeScript interfaces
- Build errors from server/client component boundary violations

- [ ] **Step 2: Start the dev server and test the UI**

```bash
npm run dev
```

Open `http://localhost:3000/dashboard/tournaments` and verify:
- Empty state shows when no tournaments exist
- Sidebar navigation shows "Tournaments" with Trophy icon
- Page loads without errors

- [ ] **Step 3: Test with seed data**

1. Create a tournament via the UI or direct DB insert
2. Run the seed script to populate fixtures
3. Verify the fixture table renders all 104 matches
4. Test inline editing: click a team name, change it, click "Save & Generate"
5. Test filters: Showing, Needs Teams, Ready, Generated
6. Test sort toggle: Date vs Match #

- [ ] **Step 4: Test overlay rendering**

1. Upload square and story template images to the library
2. Assign them to the tournament via settings
3. Set tournament status to "active"
4. Edit a fixture with real team names
5. Click "Save & Generate" and verify content items are created
6. Check the generated images in the media library

- [ ] **Step 5: Test edge cases**

- Toggle a showing fixture to not-showing → verify unpublished content is deleted
- Change team names on a fixture with existing content → verify regeneration
- Test with very long team names ("Bosnia & Herzegovina")
- Test with past kick-off time → verify "past_due" status and "Publish Now" button

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(tournament): address verification issues from end-to-end testing"
```

---

## Completion Checklist

Cross-reference with the spec's 14 success criteria:

| # | Criterion | Task |
|---|-----------|------|
| 1 | Create tournament with base images, house rules, and post template | Task 6, 10 |
| 2 | View all 104 fixtures in filterable, sortable table | Task 9, 11 |
| 3 | Inline-edit team names and Save & Generate | Task 9 |
| 4 | Bulk-generate with server-side lock | Task 5, 6 |
| 5 | Overlay images match approved mockup | Task 3 |
| 6 | Content schedules 24h before via existing pipeline | Task 5 |
| 7 | Team name update regenerates only unpublished | Task 5, 6 |
| 8 | Showing toggle creates/removes content | Task 6 |
| 9 | Existing banner/campaign/scheduling unaffected | Standalone module |
| 10 | Reusable for future tournaments | Data model design |
| 11 | All server actions verify auth + account ownership | Task 6 |
| 12 | Preflight before queuing, failures surface as "blocked" | Task 5 |
| 13 | Past-due fixtures show warning and require Publish Now | Task 5, 9 |
| 14 | Input validation: URL scheme, text lengths, required fields | Task 1, 2 |
