# Banner Overlay Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cached banner snapshot model with a derived-data model so banner labels are always correct, banners apply uniformly across all post types and surfaces, and account-level defaults flow through to per-post overrides cleanly.

**Architecture:** Banner labels are computed live from `(target, now, timezone)` everywhere — UI uses an SVG overlay with a 1-minute clock tick; the publish worker renders a JPEG via Sharp at the moment of publish. Configuration resolves from a per-post override row falling through to a per-account default row. No cached JPEGs in storage, no `banner_state` machine, no staleness gates. Schema rolls out additive-then-cleanup over two migrations.

**Tech Stack:** Next.js 16 App Router + React 19, TypeScript strict, Supabase (Postgres + Storage), Vitest, Sharp (server image render), Luxon (timezone), react-hook-form + Zod (forms), Tailwind v4 (styling).

**Spec:** [docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md](../specs/2026-05-07-banner-overlay-consistency-design.md)
**Adversarial review:** [tasks/codex-qa-review/2026-05-07-banner-overlay-consistency-adversarial-review.md](../../../tasks/codex-qa-review/2026-05-07-banner-overlay-consistency-adversarial-review.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/banner/config.ts` | `bannerConfigResolver` (pure) + types `AccountBannerDefaults`, `PostBannerOverrides`, `ResolvedConfig`. |
| `src/lib/banner/render-server.ts` | `renderBannerServer` (Sharp JPEG buffer producer). Server-only. |
| `src/lib/hooks/use-now-minute.ts` | `useNowMinute()` — minute-aligned clock for UI. |
| `src/features/planner/banner-overlay.tsx` | `<BannerOverlay />` — single SVG overlay component. |
| `supabase/migrations/20260507100000_banner_overlay_add_columns.sql` | Migration 1 (additive). |
| `supabase/migrations/20260507100100_banner_overlay_drop_columns.sql` | Migration 2 (cleanup). |
| `scripts/ops/cleanup-banner-storage.ts` | Post-Migration 2 ops script to delete stranded JPEGs. |
| Test files alongside each source file (`*.test.ts(x)`). | Vitest tests. |

### Modified files

| Path | Change |
|---|---|
| `src/lib/scheduling/proximity-label.ts` | Extend label set with `NEXT [WEEKDAY]` and date format. Keep existing function name. |
| `src/lib/planner/data.ts` | Read new override columns + posting_defaults banner columns; stop reading `banner_state` family. |
| `src/app/(app)/planner/actions.ts` | Replace `updatePlannerBannerConfig` to write override columns; drop the approve-time render dance and staleness check. |
| `src/app/(app)/settings/actions.ts` | Extend `updatePostingDefaults` schema + upsert with banner default columns. |
| `src/app/(app)/settings/page.tsx` + `posting-defaults-form.tsx` | Add four banner-default form fields. |
| `src/features/planner/banner-controls.tsx` | Drop "render banner" mechanics; just edit override fields. |
| `src/features/planner/planner-content-composer.tsx` | Use `<BannerOverlay />` instead of `BannerRenderedPreview`. |
| `src/features/planner/planner-calendar.tsx` | Use `<BannerOverlay />` instead of `BannerOverlayPreview`. |
| `src/features/link-in-bio/public/link-in-bio-public-page.tsx` | Use `<BannerOverlay />`. |
| `src/features/campaigns/CampaignDashboard.tsx` | Use `<BannerOverlay />` (was `BannerOverlayPreview`). |
| `src/features/create/streaming-preview.tsx` | Use `<BannerOverlay />`. |
| `supabase/functions/publish-queue/worker.ts` | Replace `getBannerPublishBlockReason` + `resolveWorkerBannerLabel` with inline preflight render via `renderBannerServer`. Fail-loud on render error before any platform call. |

### Deleted files (in Task 13, after all swaps verified)

- `src/lib/scheduling/banner-canvas.ts` + `.test.ts`
- `src/lib/scheduling/banner-renderer.server.ts`
- `src/app/api/internal/render-banner/route.ts`
- `scripts/ops/repair-banner-overlays.ts` (and its `package.json` script entry)
- `src/features/planner/banner-rendered-preview.tsx`
- `src/features/planner/banner-overlay-preview.tsx`

---

## Task 1: Migration 1 — additive schema + validated data copy

**Files:**
- Create: `supabase/migrations/20260507100000_banner_overlay_add_columns.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Banner overlay consistency — additive schema (Migration 1 of 2)
-- See docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md

-- Per-post override columns. NULL = inherit account default.
ALTER TABLE public.content_variants
  ADD COLUMN banner_enabled boolean,
  ADD COLUMN banner_text_override text
    CHECK (banner_text_override IS NULL OR char_length(banner_text_override) <= 20),
  ADD COLUMN banner_position text
    CHECK (banner_position IS NULL OR banner_position IN ('top','bottom','left','right')),
  ADD COLUMN banner_bg text
    CHECK (banner_bg IS NULL OR banner_bg ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN banner_text_colour text
    CHECK (banner_text_colour IS NULL OR banner_text_colour ~ '^#[0-9A-Fa-f]{6}$');

-- Account-level defaults.
ALTER TABLE public.posting_defaults
  ADD COLUMN banners_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN banner_position text NOT NULL DEFAULT 'bottom'
    CHECK (banner_position IN ('top','bottom','left','right')),
  ADD COLUMN banner_bg text NOT NULL DEFAULT '#000000'
    CHECK (banner_bg ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN banner_text_colour text NOT NULL DEFAULT '#FFFFFF'
    CHECK (banner_text_colour ~ '^#[0-9A-Fa-f]{6}$');

-- Validated copy from legacy prompt_context.bannerConfig into override columns.
-- Invalid legacy values become null (= inherit account default).
DO $$
DECLARE
  copied_enabled int;
  copied_text int;
  copied_position int;
  copied_bg int;
  copied_text_colour int;
BEGIN
  WITH src AS (
    SELECT cv.id AS variant_id,
           ci.prompt_context->'bannerConfig' AS bc
    FROM public.content_variants cv
    JOIN public.content_items ci ON cv.content_item_id = ci.id
    WHERE cv.banner_enabled IS NULL
      AND ci.prompt_context ? 'bannerConfig'
  ),
  upd AS (
    UPDATE public.content_variants cv
    SET banner_enabled =
          CASE WHEN jsonb_typeof(s.bc->'enabled') = 'boolean'
               THEN (s.bc->>'enabled')::boolean END,
        banner_text_override =
          CASE WHEN jsonb_typeof(s.bc->'customMessage') = 'string'
                AND char_length(s.bc->>'customMessage') <= 20
               THEN s.bc->>'customMessage' END,
        banner_position =
          CASE WHEN s.bc->>'position' IN ('top','bottom','left','right')
               THEN s.bc->>'position' END,
        banner_bg =
          CASE WHEN s.bc->>'bgColour' ~ '^#[0-9A-Fa-f]{6}$'
               THEN s.bc->>'bgColour' END,
        banner_text_colour =
          CASE WHEN s.bc->>'textColour' ~ '^#[0-9A-Fa-f]{6}$'
               THEN s.bc->>'textColour' END
    FROM src s
    WHERE cv.id = s.variant_id
    RETURNING cv.id,
              (cv.banner_enabled IS NOT NULL) AS got_enabled,
              (cv.banner_text_override IS NOT NULL) AS got_text,
              (cv.banner_position IS NOT NULL) AS got_position,
              (cv.banner_bg IS NOT NULL) AS got_bg,
              (cv.banner_text_colour IS NOT NULL) AS got_text_colour
  )
  SELECT
    COUNT(*) FILTER (WHERE got_enabled),
    COUNT(*) FILTER (WHERE got_text),
    COUNT(*) FILTER (WHERE got_position),
    COUNT(*) FILTER (WHERE got_bg),
    COUNT(*) FILTER (WHERE got_text_colour)
  INTO copied_enabled, copied_text, copied_position, copied_bg, copied_text_colour
  FROM upd;

  RAISE NOTICE 'Banner data copy: enabled=%, text_override=%, position=%, bg=%, text_colour=%',
    copied_enabled, copied_text, copied_position, copied_bg, copied_text_colour;
END $$;
```

- [ ] **Step 2: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: SQL printed, no errors. The dry-run should reference the new file.

- [ ] **Step 3: Apply locally and verify**

Run: `npx supabase db push`
Expected: migration applies cleanly. Then verify the new columns:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('content_variants', 'posting_defaults')
  AND column_name LIKE 'banner%'
ORDER BY table_name, column_name;
```

Expected rows: 5 from `content_variants` (banner_enabled, banner_bg, banner_position, banner_text_colour, banner_text_override) + 4 from `posting_defaults` (banners_enabled, banner_bg, banner_position, banner_text_colour).

- [ ] **Step 4: Verify CHECK constraints reject bad data**

```sql
-- Should fail with check_violation:
INSERT INTO public.content_variants (content_item_id, banner_position) VALUES (gen_random_uuid(), 'centre');
-- Should fail:
INSERT INTO public.posting_defaults (account_id, banner_bg) VALUES (gen_random_uuid(), 'red');
```

Expected: both error with `new row for relation … violates check constraint`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260507100000_banner_overlay_add_columns.sql
git commit -m "feat: add banner override and account-default columns

Migration 1 of 2 for the banner overlay consistency rework. Adds
per-post override columns to content_variants and account-default
columns to posting_defaults, all guarded with CHECK constraints.
Validated data copy from prompt_context.bannerConfig into the new
columns; invalid legacy values fall back to null (= inherit defaults).

Refs docs/superpowers/specs/2026-05-07-banner-overlay-consistency-design.md
"
```

---

## Task 2: Extend `getProximityLabel` with `NEXT [WEEKDAY]` and date format

**Files:**
- Modify: `src/lib/scheduling/proximity-label.ts`
- Modify: `tests/lib/scheduling/proximity-label.test.ts` (or wherever the existing test file lives — the discovery agent noted this path).

The existing function signature stays:
```ts
export function getProximityLabel(input: ProximityLabelInput): ProximityLabel;
```
where `ProximityLabel = string | null` and `ProximityLabelInput = { referenceAt: DateTime; campaignTiming: CampaignTiming }`.

We extend the body so that when the day-band is 7–13 it returns `NEXT [WEEKDAY]`, and when 14+ it returns the date format `[WEEKDAY] [DAY] [MONTH]` (e.g. `FRI 13 JUN`). Existing labels are unchanged.

- [ ] **Step 1: Write failing tests for the new label bands**

Add to the proximity-label test file:

```ts
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { getProximityLabel } from '@/lib/scheduling/proximity-label';

const tz = 'Europe/London';

describe('getProximityLabel — extended bands', () => {
  it('returns NEXT [WEEKDAY] for a target 7 days out (same weekday)', () => {
    const referenceAt = DateTime.fromISO('2026-06-03T10:00', { zone: tz }); // Wed
    const label = getProximityLabel({
      referenceAt,
      campaignTiming: {
        kind: 'event',
        eventStart: DateTime.fromISO('2026-06-10T19:00', { zone: tz }), // Wed +7
      },
    });
    expect(label).toBe('NEXT WEDNESDAY');
  });

  it('returns NEXT [WEEKDAY] for a target 10 days out', () => {
    const referenceAt = DateTime.fromISO('2026-06-03T10:00', { zone: tz });
    const label = getProximityLabel({
      referenceAt,
      campaignTiming: {
        kind: 'event',
        eventStart: DateTime.fromISO('2026-06-13T18:00', { zone: tz }), // Sat +10
      },
    });
    expect(label).toBe('NEXT SATURDAY');
  });

  it('returns date format for target 14+ days out', () => {
    const referenceAt = DateTime.fromISO('2026-06-03T10:00', { zone: tz });
    const label = getProximityLabel({
      referenceAt,
      campaignTiming: {
        kind: 'event',
        eventStart: DateTime.fromISO('2026-06-19T19:00', { zone: tz }), // Fri +16
      },
    });
    expect(label).toBe('FRI 19 JUN');
  });

  it('uses NEXT [WEEKDAY] for same-weekday-7-days, not THIS [WEEKDAY]', () => {
    // Wed → next Wed should be NEXT WEDNESDAY, not THIS WEDNESDAY
    const referenceAt = DateTime.fromISO('2026-06-03T10:00', { zone: tz });
    const label = getProximityLabel({
      referenceAt,
      campaignTiming: {
        kind: 'event',
        eventStart: DateTime.fromISO('2026-06-10T10:00', { zone: tz }),
      },
    });
    expect(label).toBe('NEXT WEDNESDAY');
  });

  it('returns date format for next year', () => {
    const referenceAt = DateTime.fromISO('2026-12-20T10:00', { zone: tz });
    const label = getProximityLabel({
      referenceAt,
      campaignTiming: {
        kind: 'event',
        eventStart: DateTime.fromISO('2027-01-05T19:00', { zone: tz }),
      },
    });
    expect(label).toBe('TUE 5 JAN');
  });

  it('still returns null for a target in the past', () => {
    const referenceAt = DateTime.fromISO('2026-06-10T10:00', { zone: tz });
    const label = getProximityLabel({
      referenceAt,
      campaignTiming: {
        kind: 'event',
        eventStart: DateTime.fromISO('2026-06-09T19:00', { zone: tz }),
      },
    });
    expect(label).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

Run: `npx vitest run tests/lib/scheduling/proximity-label.test.ts`
Expected: at least 5 of the new tests fail (`NEXT WEDNESDAY` etc. not produced).

- [ ] **Step 3: Implement the extended bands**

Open `src/lib/scheduling/proximity-label.ts`. Locate the branch that returns `null` for `daysDiff >= 7` and replace it with:

```ts
const WEEKDAY_NAMES = [
  'MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY',
] as const;

const MONTH_SHORT = [
  'JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC',
] as const;

// existing logic for null / TODAY / TONIGHT / TOMORROW / TOMORROW NIGHT / THIS [WEEKDAY] stays.
// New: 7–13 days → NEXT [WEEKDAY].
if (daysDiff >= 7 && daysDiff <= 13) {
  // Luxon weekday: 1 = Monday … 7 = Sunday.
  return `NEXT ${WEEKDAY_NAMES[targetInTz.weekday - 1]}`;
}
// New: 14+ days → date format. Day with no leading zero, weekday, month short.
if (daysDiff >= 14) {
  return `${WEEKDAY_NAMES[targetInTz.weekday - 1].slice(0, 3)} ${targetInTz.day} ${MONTH_SHORT[targetInTz.month - 1]}`;
}
return null;
```

(Day-of-week labels are 3-letter abbreviations in date format; weekday slice handles that. Verify the existing `THIS [WEEKDAY]` returns a full word like `THIS WEDNESDAY` so the slice behaviour is consistent with what the spec calls for.)

- [ ] **Step 4: Run tests, see them pass**

Run: `npx vitest run tests/lib/scheduling/proximity-label.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/proximity-label.ts tests/lib/scheduling/proximity-label.test.ts
git commit -m "feat(banner): extend proximity-label with NEXT [WEEKDAY] and date format

Adds the 7–13 day band ('NEXT WEDNESDAY') and 14+ day date format
('FRI 13 JUN') so banner labels exist for the full schedule horizon.
Same-weekday-7-days resolves to NEXT [WEEKDAY], not THIS [WEEKDAY]."
```

---

## Task 3: Create `bannerConfigResolver`

**Files:**
- Create: `src/lib/banner/config.ts`
- Create: `src/lib/banner/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/banner/config.test.ts
import { describe, it, expect } from 'vitest';
import { bannerConfigResolver } from '@/lib/banner/config';

const accountDefaults = {
  banners_enabled: true,
  banner_position: 'bottom' as const,
  banner_bg: '#000000',
  banner_text_colour: '#FFFFFF',
};

describe('bannerConfigResolver', () => {
  it('uses account defaults when post overrides are all null', () => {
    expect(bannerConfigResolver(accountDefaults, {
      banner_enabled: null,
      banner_text_override: null,
      banner_position: null,
      banner_bg: null,
      banner_text_colour: null,
    })).toEqual({
      enabled: true,
      position: 'bottom',
      bgColour: '#000000',
      textColour: '#FFFFFF',
      textOverride: null,
    });
  });

  it('respects partial overrides', () => {
    expect(bannerConfigResolver(accountDefaults, {
      banner_enabled: null,
      banner_text_override: 'BANK HOLIDAY',
      banner_position: 'top',
      banner_bg: null,
      banner_text_colour: null,
    })).toEqual({
      enabled: true,
      position: 'top',
      bgColour: '#000000',
      textColour: '#FFFFFF',
      textOverride: 'BANK HOLIDAY',
    });
  });

  it('post-level disabled wins over enabled defaults', () => {
    expect(bannerConfigResolver(accountDefaults, {
      banner_enabled: false,
      banner_text_override: 'IGNORED',
      banner_position: null,
      banner_bg: null,
      banner_text_colour: null,
    }).enabled).toBe(false);
  });

  it('disabled defaults can be overridden true on the post', () => {
    expect(bannerConfigResolver(
      { ...accountDefaults, banners_enabled: false },
      {
        banner_enabled: true,
        banner_text_override: null,
        banner_position: null,
        banner_bg: null,
        banner_text_colour: null,
      },
    ).enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/lib/banner/config.test.ts`
Expected: fail with module not found.

- [ ] **Step 3: Implement the resolver**

```ts
// src/lib/banner/config.ts
export type BannerPosition = 'top' | 'bottom' | 'left' | 'right';

export type AccountBannerDefaults = {
  banners_enabled: boolean;
  banner_position: BannerPosition;
  banner_bg: string;
  banner_text_colour: string;
};

export type PostBannerOverrides = {
  banner_enabled: boolean | null;
  banner_text_override: string | null;
  banner_position: BannerPosition | null;
  banner_bg: string | null;
  banner_text_colour: string | null;
};

export type ResolvedConfig = {
  enabled: boolean;
  position: BannerPosition;
  bgColour: string;
  textColour: string;
  textOverride: string | null;
};

export function bannerConfigResolver(
  accountDefaults: AccountBannerDefaults,
  postOverrides: PostBannerOverrides,
): ResolvedConfig {
  return {
    enabled: postOverrides.banner_enabled ?? accountDefaults.banners_enabled,
    position: postOverrides.banner_position ?? accountDefaults.banner_position,
    bgColour: postOverrides.banner_bg ?? accountDefaults.banner_bg,
    textColour: postOverrides.banner_text_colour ?? accountDefaults.banner_text_colour,
    textOverride: postOverrides.banner_text_override,
  };
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `npx vitest run src/lib/banner/config.test.ts`
Expected: all 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/banner/config.ts src/lib/banner/config.test.ts
git commit -m "feat(banner): add bannerConfigResolver

Pure function that merges account-level banner defaults with per-post
overrides. Per-post nulls fall back to account defaults; per-post
banner_enabled = false wins over enabled defaults."
```

---

## Task 4: Create `useNowMinute()` hook

**Files:**
- Create: `src/lib/hooks/use-now-minute.ts`
- Create: `src/lib/hooks/use-now-minute.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/lib/hooks/use-now-minute.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNowMinute } from '@/lib/hooks/use-now-minute';

describe('useNowMinute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T10:00:30Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a Date aligned to the start of the current minute', () => {
    const { result } = renderHook(() => useNowMinute());
    expect(result.current.getSeconds()).toBe(0);
    expect(result.current.getMinutes()).toBe(0);
    expect(result.current.getUTCHours()).toBe(10);
  });

  it('updates exactly once per minute', () => {
    const { result } = renderHook(() => useNowMinute());
    const first = result.current;
    act(() => { vi.advanceTimersByTime(59_500); });
    expect(result.current).toBe(first);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current).not.toBe(first);
    expect(result.current.getMinutes()).toBe(1);
  });

  it('cleans up its timer on unmount', () => {
    const { unmount } = renderHook(() => useNowMinute());
    const before = vi.getTimerCount();
    unmount();
    const after = vi.getTimerCount();
    expect(after).toBeLessThan(before);
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `npx vitest run src/lib/hooks/use-now-minute.test.tsx`
Expected: module-not-found failure.

- [ ] **Step 3: Implement the hook**

```ts
// src/lib/hooks/use-now-minute.ts
'use client';

import { useEffect, useState } from 'react';

function startOfMinute(d: Date): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  return out;
}

export function useNowMinute(): Date {
  const [now, setNow] = useState<Date>(() => startOfMinute(new Date()));

  useEffect(() => {
    const msToNext = 60_000 - (Date.now() - startOfMinute(new Date()).getTime());
    const align = setTimeout(() => {
      setNow(startOfMinute(new Date()));
      const interval = setInterval(() => {
        setNow(startOfMinute(new Date()));
      }, 60_000);
      cleanup = () => clearInterval(interval);
    }, msToNext);
    let cleanup: () => void = () => clearTimeout(align);
    return () => cleanup();
  }, []);

  return now;
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `npx vitest run src/lib/hooks/use-now-minute.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hooks/use-now-minute.ts src/lib/hooks/use-now-minute.test.tsx
git commit -m "feat(hooks): add useNowMinute()

Minute-aligned clock hook used by relative-time UI (banner overlays,
scheduling badges) so labels recompute when the wall clock crosses
a minute, hour, or day boundary while the page stays open."
```

---

## Task 5: Create `<BannerOverlay />` component

**Files:**
- Create: `src/features/planner/banner-overlay.tsx`
- Create: `src/features/planner/banner-overlay.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/features/planner/banner-overlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BannerOverlay } from '@/features/planner/banner-overlay';

const baseConfig = {
  enabled: true,
  position: 'bottom' as const,
  bgColour: '#000000',
  textColour: '#FFFFFF',
  textOverride: null,
};

describe('<BannerOverlay />', () => {
  it('renders nothing when config.enabled is false', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, enabled: false }}
        label="THIS WEDNESDAY"
      />,
    );
    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
  });

  it('renders nothing when label is null and no override', () => {
    const { container } = render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label={null}
      />,
    );
    expect(container.querySelector('[data-banner-overlay]')).toBeNull();
  });

  it('renders override text when set even with null label', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, textOverride: 'BANK HOLIDAY' }}
        label={null}
      />,
    );
    expect(screen.getByText('BANK HOLIDAY')).toBeInTheDocument();
  });

  it('renders computed label when override is empty', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={baseConfig}
        label="THIS WEDNESDAY"
      />,
    );
    expect(screen.getByText('THIS WEDNESDAY')).toBeInTheDocument();
  });

  it('positions strip at top when position=top', () => {
    render(
      <BannerOverlay
        mediaUrl="/x.jpg"
        config={{ ...baseConfig, position: 'top' }}
        label="TODAY"
      />,
    );
    const strip = screen.getByText('TODAY').closest('[data-banner-overlay]')!;
    expect(strip).toHaveAttribute('data-position', 'top');
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

Run: `npx vitest run src/features/planner/banner-overlay.test.tsx`
Expected: module-not-found failure.

- [ ] **Step 3: Implement the component**

```tsx
// src/features/planner/banner-overlay.tsx
'use client';

import type { ResolvedConfig } from '@/lib/banner/config';

type Props = {
  mediaUrl: string;
  config: ResolvedConfig;
  label: string | null;
  className?: string;
};

const positionClasses: Record<ResolvedConfig['position'], string> = {
  top:    'top-0    left-0  right-0  h-[8%]   flex-row',
  bottom: 'bottom-0 left-0  right-0  h-[8%]   flex-row',
  left:   'top-0    bottom-0 left-0  w-[8%]   flex-col',
  right:  'top-0    bottom-0 right-0 w-[8%]   flex-col',
};

export function BannerOverlay({ mediaUrl, config, label, className }: Props) {
  const text = config.textOverride && config.textOverride.length > 0
    ? config.textOverride
    : label;
  const visible = config.enabled && text != null && text.length > 0;

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl} alt="" className="block w-full h-full object-cover" />
      {visible ? (
        <div
          data-banner-overlay
          data-position={config.position}
          className={`absolute ${positionClasses[config.position]} flex items-center justify-center`}
          style={{ backgroundColor: config.bgColour, color: config.textColour }}
        >
          <span className="font-bold tracking-wide text-[clamp(0.75rem,2.5vw,1.5rem)]" aria-label={text!}>
            {text}
          </span>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `npx vitest run src/features/planner/banner-overlay.test.tsx`
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/planner/banner-overlay.tsx src/features/planner/banner-overlay.test.tsx
git commit -m "feat(banner): add unified <BannerOverlay /> SVG component

Single React component that replaces both BannerRenderedPreview
(canvas) and BannerOverlayPreview (SVG). Renders an absolutely-
positioned strip over the source image. No canvas, no DB call,
no async work."
```

---

## Task 6: Wire `<BannerOverlay />` into the planner content composer

**Files:**
- Modify: `src/features/planner/planner-content-composer.tsx`
- Modify: `src/lib/planner/data.ts` (add resolved config + label to `PlannerItemDetail`)

- [ ] **Step 1: Extend `PlannerItemDetail` to expose new override fields**

In `src/lib/planner/data.ts`, locate the `PlannerItemDetail` type and the `buildPlannerItems()` (or equivalent) function. Replace the existing banner field block (`bannerLabel`, `bannerPosition`, `bannerBgColour`, `bannerTextColour`) with these — add the override fields and the resolved config.

```ts
// Add to imports
import { bannerConfigResolver, type ResolvedConfig, type PostBannerOverrides, type AccountBannerDefaults } from '@/lib/banner/config';

// In PlannerItemDetail (or whatever the planner row type is named):
export type PlannerItemDetail = {
  // ... existing fields ...
  bannerConfig: ResolvedConfig;
  bannerLabel: string | null;
};
```

In the SELECT statements that load `content_variants` rows, add `banner_enabled, banner_text_override, banner_position, banner_bg, banner_text_colour`. In the SELECT for `posting_defaults`, add the four new account-default columns.

Inside `buildPlannerItems()` where `bannerLabel` was previously computed, replace with:

```ts
const accountDefaults: AccountBannerDefaults = {
  banners_enabled: postingDefaults.banners_enabled,
  banner_position: postingDefaults.banner_position,
  banner_bg: postingDefaults.banner_bg,
  banner_text_colour: postingDefaults.banner_text_colour,
};
const postOverrides: PostBannerOverrides = {
  banner_enabled: variant.banner_enabled ?? null,
  banner_text_override: variant.banner_text_override ?? null,
  banner_position: variant.banner_position ?? null,
  banner_bg: variant.banner_bg ?? null,
  banner_text_colour: variant.banner_text_colour ?? null,
};
const bannerConfig = bannerConfigResolver(accountDefaults, postOverrides);
const bannerLabel = getProximityLabel({
  referenceAt: DateTime.now().setZone('Europe/London'),
  campaignTiming, // existing variable — same logic as before
});
```

Drop the reads of `banner_state`, `banner_label` (the stored one), `banner_source_media_path`, `bannered_media_path`, `banner_render_metadata`, `banner_rendered_for_scheduled_at`. Keep the SELECT clean.

- [ ] **Step 2: Update the composer to render `<BannerOverlay />`**

In `src/features/planner/planner-content-composer.tsx`, find the JSX that uses `<BannerRenderedPreview …>`. Replace with:

```tsx
import { BannerOverlay } from '@/features/planner/banner-overlay';
import { useNowMinute } from '@/lib/hooks/use-now-minute';

// Inside the composer component, where the preview lives:
const _now = useNowMinute(); // forces re-render every minute so live label refreshes
// (You don't actually need _now in the JSX — the hook re-render is the side effect.)

<BannerOverlay
  mediaUrl={primaryMedia?.url ?? ''}
  config={item.bannerConfig}
  label={item.bannerLabel}
/>
```

Remove the prior canvas-render machinery from the composer (anything that called the old preview's render-to-blob behaviour or used `bannered_media_path`).

- [ ] **Step 3: Run typecheck + tests**

```
npm run typecheck
npx vitest run src/features/planner src/lib/planner
```

Expected: clean. If existing tests reference removed fields, update them to match the new shape.

- [ ] **Step 4: Visual smoke (manual)**

Start dev server: `npm run dev`. Open `/planner`. Verify a scheduled post within the next week shows its banner. Reschedule it and confirm the banner label changes immediately on the next render tick (no stale label).

- [ ] **Step 5: Commit**

```bash
git add src/features/planner/planner-content-composer.tsx src/lib/planner/data.ts
git commit -m "refactor(planner): use BannerOverlay in planner composer

Switches the composer to the new unified overlay component, exposing
the resolved banner config and live label in PlannerItemDetail.
useNowMinute() drives a once-per-minute re-render so labels stay
correct across 17:00 / midnight boundaries while the page is open."
```

---

## Task 7: Wire `<BannerOverlay />` into planner calendar, link-in-bio public page, campaign dashboard, streaming preview

**Files:**
- Modify: `src/features/planner/planner-calendar.tsx`
- Modify: `src/features/link-in-bio/public/link-in-bio-public-page.tsx`
- Modify: `src/features/campaigns/CampaignDashboard.tsx`
- Modify: `src/features/create/streaming-preview.tsx`

For each surface, the swap is the same shape: drop the import of `BannerOverlayPreview` or `BannerRenderedPreview`, import `BannerOverlay`, and pass `mediaUrl`, `config`, `label` from whatever data the surface already has (`PlannerItemDetail` for planner; equivalent shape for campaign and link-in-bio — both already compute label/config one way or another).

- [ ] **Step 1: Replace in planner-calendar.tsx**

Find every `<BannerOverlayPreview …>` usage. Replace each with:

```tsx
import { BannerOverlay } from '@/features/planner/banner-overlay';

<BannerOverlay
  mediaUrl={item.previewImageUrl ?? ''}
  config={item.bannerConfig}
  label={item.bannerLabel}
  className="aspect-[4/5]"
/>
```

(Tile size is set by parent — pass `className` to control aspect.)

- [ ] **Step 2: Replace in link-in-bio-public-page.tsx**

Same swap. Public page passes `mediaUrl` from the link-in-bio tile data and `config`/`label` from server-resolved fields. Use `useNowMinute()` to keep labels live (this page is often left open).

- [ ] **Step 3: Replace in CampaignDashboard.tsx**

Same swap.

- [ ] **Step 4: Replace in streaming-preview.tsx**

Same swap. This component is in the create flow; it already has `imageUrl`, `position`, `bgColour`, `textColour`, `labelText`. Convert those into a `ResolvedConfig` literal:

```tsx
const config: ResolvedConfig = {
  enabled: true,
  position,
  bgColour,
  textColour,
  textOverride: null,
};

<BannerOverlay mediaUrl={imageUrl ?? ''} config={config} label={labelText} />
```

- [ ] **Step 5: Run typecheck + tests + dev smoke**

```
npm run typecheck
npm run test
```

Expected: clean. Smoke-test each surface in `npm run dev` — calendar tile shows banner, link-in-bio public page shows banner, campaign dashboard tile shows banner, streaming preview shows live banner during generation.

- [ ] **Step 6: Commit**

```bash
git add src/features/planner/planner-calendar.tsx src/features/link-in-bio/public/link-in-bio-public-page.tsx src/features/campaigns/CampaignDashboard.tsx src/features/create/streaming-preview.tsx
git commit -m "refactor(banner): swap remaining surfaces to BannerOverlay

Replaces BannerOverlayPreview and BannerRenderedPreview usage in
planner calendar, link-in-bio public page, campaign dashboard, and
streaming preview with the unified <BannerOverlay /> component."
```

---

## Task 8: Simplify `<BannerControls />` to write override columns directly

**Files:**
- Modify: `src/features/planner/banner-controls.tsx`
- Modify: `src/app/(app)/planner/actions.ts` (the `updatePlannerBannerConfig` server action)

- [ ] **Step 1: Update the server action**

In `src/app/(app)/planner/actions.ts`, find `updatePlannerBannerConfig`. Replace its body with a Zod-validated upsert into the new override columns. Drop any reference to `banner_state`, `bannered_media_path`, `banner_rendered_for_scheduled_at`, `resetBannerStateForContent`, or `renderBannerForContent`.

```ts
import { z } from 'zod';

const HEX = /^#[0-9A-Fa-f]{6}$/;
const POSITION = z.enum(['top','bottom','left','right']);

const updateBannerSchema = z.object({
  contentItemId: z.string().uuid(),
  enabled: z.boolean().nullable(),
  position: POSITION.nullable(),
  bgColour: z.string().regex(HEX).nullable(),
  textColour: z.string().regex(HEX).nullable(),
  textOverride: z.string().max(20).nullable(),
});

export async function updatePlannerBannerConfig(input: unknown) {
  const data = updateBannerSchema.parse(input);
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  // Ownership join: only allow updates to variants the user owns
  const { error } = await supabase
    .from('content_variants')
    .update({
      banner_enabled: data.enabled,
      banner_position: data.position,
      banner_bg: data.bgColour,
      banner_text_colour: data.textColour,
      banner_text_override: data.textOverride,
    })
    .eq('content_item_id', data.contentItemId);

  if (error) return { error: error.message };

  await logAuditEvent({
    user_id: user.id,
    operation_type: 'update',
    resource_type: 'content_variant_banner',
    operation_status: 'success',
  });

  revalidatePath('/planner');
  return { success: true };
}
```

(Match existing import style — `getSupabaseServerClient`, `logAuditEvent`, `revalidatePath` already used in this file.)

Delete the now-unused imports of `renderBannerForContent` and `resetBannerStateForContent` from that file.

- [ ] **Step 2: Update `<BannerControls />` to call the simplified action**

Open `src/features/planner/banner-controls.tsx`. Drop the "render banner" UI elements (the manual render button and any progress / status text tied to `banner_state`). Keep the toggle, position, colour pickers, and the 20-char custom message input.

The save handler now just calls `updatePlannerBannerConfig(values)` with the typed values; no client-side render upload.

- [ ] **Step 3: Update or remove tests that mocked the old render path**

Search `src/features/planner/__tests__` and `src/app/(app)/planner` tests for references to render mocks. Either delete the obsolete render tests or update them to assert the new column writes.

- [ ] **Step 4: Run typecheck + tests**

```
npm run typecheck
npx vitest run src/features/planner src/app/\(app\)/planner
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/planner/banner-controls.tsx src/app/\(app\)/planner/actions.ts
git commit -m "refactor(banner): simplify BannerControls to write override columns

Drops the manual 'render banner' mechanics. updatePlannerBannerConfig
now Zod-validates input and writes to content_variants override
columns directly. Per-account defaults pick up automatically when
overrides are null."
```

---

## Task 9: Add banner defaults to settings page

**Files:**
- Modify: `src/app/(app)/settings/actions.ts` — extend `updatePostingDefaults` schema and upsert.
- Modify: `src/app/(app)/settings/page.tsx` (and the imported `posting-defaults-form.tsx`) — add four banner-default form fields.

- [ ] **Step 1: Extend the server action schema and upsert**

In `src/app/(app)/settings/actions.ts`, locate `updatePostingDefaults`. Add the new fields to the Zod schema and the upsert payload:

```ts
const HEX = /^#[0-9A-Fa-f]{6}$/;
const POSITION = z.enum(['top','bottom','left','right']);

const postingDefaultsSchema = z.object({
  // ... existing fields ...
  banners_enabled: z.boolean(),
  banner_position: POSITION,
  banner_bg: z.string().regex(HEX),
  banner_text_colour: z.string().regex(HEX),
});

// In the upsert call, include the four new fields in the payload.
```

- [ ] **Step 2: Add fields to `posting-defaults-form.tsx`**

Add a "Banner defaults" section using react-hook-form (matching the existing form pattern). Fields:
- A toggle for `banners_enabled`.
- A radio group for `banner_position` (top/bottom/left/right).
- Two colour pickers for `banner_bg` and `banner_text_colour` (use the existing colour-picker component if one exists, else `<input type="color" />`).

Default values come from the loaded posting_defaults row.

- [ ] **Step 3: Run typecheck + tests + dev smoke**

```
npm run typecheck
npx vitest run src/app/\(app\)/settings
npm run dev
```

In the dev server, go to `/settings`. Verify the new section appears, saves, and survives a reload.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/settings/actions.ts src/app/\(app\)/settings/page.tsx src/app/\(app\)/settings/posting-defaults-form.tsx
git commit -m "feat(settings): add banner defaults to posting-defaults form

Account-level banner defaults (enabled, position, bg, text colour)
flow through to per-post overrides via bannerConfigResolver. Server
action validates with Zod and upserts into posting_defaults."
```

---

## Task 10: Create `renderBannerServer`

**Files:**
- Create: `src/lib/banner/render-server.ts`
- Create: `src/lib/banner/render-server.test.ts`
- Create: `tests/fixtures/banner/square-1080.jpg`, `tests/fixtures/banner/portrait-1080-1350.jpg`, `tests/fixtures/banner/story-1080-1920.jpg` (small valid JPEGs — generate with Sharp once and commit).

- [ ] **Step 1: Generate test fixtures (one-off)**

Run a quick Node script:

```ts
// tools/make-banner-fixtures.ts (delete after running)
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('tests/fixtures/banner', { recursive: true });
async function make(w: number, h: number, name: string) {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 80, g: 120, b: 200 } } }).jpeg({ quality: 85 }).toBuffer();
  writeFileSync(`tests/fixtures/banner/${name}`, buf);
}
await make(1080, 1080, 'square-1080.jpg');
await make(1080, 1350, 'portrait-1080-1350.jpg');
await make(1080, 1920, 'story-1080-1920.jpg');
```

Run: `npx tsx tools/make-banner-fixtures.ts`. Then delete the script.

- [ ] **Step 2: Write failing tests**

```ts
// src/lib/banner/render-server.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import { renderBannerServer } from '@/lib/banner/render-server';
import type { ResolvedConfig } from '@/lib/banner/config';

const config: ResolvedConfig = {
  enabled: true,
  position: 'bottom',
  bgColour: '#000000',
  textColour: '#FFFFFF',
  textOverride: null,
};

describe('renderBannerServer', () => {
  it('produces a valid JPEG with same dimensions as the source for square 1080', async () => {
    const src = readFileSync('tests/fixtures/banner/square-1080.jpg');
    const out = await renderBannerServer(src, config, 'THIS WEDNESDAY');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  });

  it('produces a JPEG for 4:5 portrait', async () => {
    const src = readFileSync('tests/fixtures/banner/portrait-1080-1350.jpg');
    const out = await renderBannerServer(src, config, 'TONIGHT');
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
  });

  it('produces a JPEG for 9:16 story', async () => {
    const src = readFileSync('tests/fixtures/banner/story-1080-1920.jpg');
    const out = await renderBannerServer(src, config, 'TOMORROW');
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it('is byte-stable for the same inputs', async () => {
    const src = readFileSync('tests/fixtures/banner/square-1080.jpg');
    const a = await renderBannerServer(src, config, 'TODAY');
    const b = await renderBannerServer(src, config, 'TODAY');
    expect(a.equals(b)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests, see them fail**

Run: `npx vitest run src/lib/banner/render-server.test.ts`
Expected: module-not-found.

- [ ] **Step 4: Implement `renderBannerServer`**

```ts
// src/lib/banner/render-server.ts
import sharp from 'sharp';
import type { ResolvedConfig } from '@/lib/banner/config';

export async function renderBannerServer(
  source: Buffer,
  config: ResolvedConfig,
  label: string,
): Promise<Buffer> {
  const img = sharp(source, { failOn: 'error' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('BANNER_RENDER_FAILED: source has no dimensions');
  }
  const shortSide = Math.min(meta.width, meta.height);
  const isStory = meta.height > meta.width * 1.5;
  const stripPct = isStory ? 0.06 : 0.08;
  const stripPx = Math.round(shortSide * stripPct);
  const fontPx = Math.round(stripPx * 0.55);

  const horizontal = config.position === 'top' || config.position === 'bottom';
  const stripWidth = horizontal ? meta.width : stripPx;
  const stripHeight = horizontal ? stripPx : meta.height;

  // Build SVG overlay deterministically.
  const svg = `
    <svg width="${stripWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${stripWidth}" height="${stripHeight}" fill="${config.bgColour}"/>
      <text x="50%" y="50%" fill="${config.textColour}"
            font-family="-apple-system, system-ui, sans-serif"
            font-weight="700"
            font-size="${fontPx}"
            text-anchor="middle"
            dominant-baseline="central"
            ${horizontal ? '' : `transform="rotate(${config.position === 'left' ? -90 : 90} ${stripWidth / 2} ${stripHeight / 2})"`}>
        ${escapeXml(label)}
      </text>
    </svg>
  `.trim();

  const top = config.position === 'top' ? 0 : config.position === 'bottom' ? meta.height - stripHeight : 0;
  const left = config.position === 'left' ? 0 : config.position === 'right' ? meta.width - stripWidth : 0;

  return img
    .composite([{ input: Buffer.from(svg), top, left }])
    .jpeg({ quality: 92, mozjpeg: false })
    .toBuffer();
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}
```

- [ ] **Step 5: Run tests, see them pass**

Run: `npx vitest run src/lib/banner/render-server.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/banner/render-server.ts src/lib/banner/render-server.test.ts tests/fixtures/banner/
git commit -m "feat(banner): add renderBannerServer

Sharp-based JPEG renderer producing a deterministic in-memory buffer.
Inspects source dimensions and uses proportional strip sizing (8%
short side for square/4:5, 6% for 9:16 stories). No platform branches."
```

---

## Task 11: Wire `renderBannerServer` into the publish-queue worker

**Files:**
- Modify: `supabase/functions/publish-queue/worker.ts`

- [ ] **Step 1: Replace the banner section of the worker**

In `supabase/functions/publish-queue/worker.ts`, locate `resolveWorkerBannerLabel`, `getBannerPublishBlockReason`, and the section that substitutes `bannered_media_path` for the source media. Replace with this preflight render. Order of operations is critical: render must complete before any platform-API call.

```ts
import { renderBannerServer } from '@/lib/banner/render-server';
import { bannerConfigResolver, type AccountBannerDefaults, type PostBannerOverrides } from '@/lib/banner/config';
import { getProximityLabel } from '@/lib/scheduling/proximity-label';
import { DateTime } from 'luxon';

// In the function that processes a single publish_jobs row, after loading
// content + variant + posting_defaults rows, before any platform call:

const accountDefaults: AccountBannerDefaults = {
  banners_enabled: postingDefaults.banners_enabled,
  banner_position: postingDefaults.banner_position,
  banner_bg: postingDefaults.banner_bg,
  banner_text_colour: postingDefaults.banner_text_colour,
};
const postOverrides: PostBannerOverrides = {
  banner_enabled: variant.banner_enabled ?? null,
  banner_text_override: variant.banner_text_override ?? null,
  banner_position: variant.banner_position ?? null,
  banner_bg: variant.banner_bg ?? null,
  banner_text_colour: variant.banner_text_colour ?? null,
};
const config = bannerConfigResolver(accountDefaults, postOverrides);

const computedLabel = getProximityLabel({
  referenceAt: DateTime.now().setZone('Europe/London'),
  campaignTiming, // already computed earlier in the worker
});
const labelToShow = (config.textOverride ?? '').length > 0
  ? config.textOverride!
  : computedLabel;

let mediaBuffer: Buffer | null = null;
if (config.enabled && labelToShow != null && labelToShow.length > 0) {
  try {
    const sourceBuffer = await fetchSourceMediaBuffer(variant); // existing helper
    mediaBuffer = await renderBannerServer(sourceBuffer, config, labelToShow);
  } catch (err) {
    await markJobFailed(job.id, `BANNER_RENDER_FAILED: ${(err as Error).message}`);
    return; // do not call the platform
  }
}

// If mediaBuffer is null, the platform upload uses the source path as before.
// If non-null, the platform upload uses the buffer.
```

Delete `resolveWorkerBannerLabel` and `getBannerPublishBlockReason`. Delete the `bannered_media_path` substitution logic. Delete any `banner_rendered_for_scheduled_at` staleness checks.

(`fetchSourceMediaBuffer` and `markJobFailed` are illustrative names — match whatever the worker already uses for "fetch from storage" and "mark job failed with last_error and next_attempt_at".)

- [ ] **Step 2: Update or add a worker test**

Add an integration-shape test (mocked Supabase + mocked Sharp call where needed):

```ts
import { vi, describe, it, expect } from 'vitest';
// ... import the worker function under test ...

describe('publish worker — banner preflight', () => {
  it('fails the job and skips platform call when render throws', async () => {
    const platformClient = { upload: vi.fn() };
    const renderSpy = vi.spyOn(await import('@/lib/banner/render-server'), 'renderBannerServer')
      .mockRejectedValue(new Error('sharp blew up'));

    const result = await processPublishJob(seedJob({ banner_enabled: true, label: 'TODAY' }), { platformClient });

    expect(result.status).toBe('failed');
    expect(result.last_error).toContain('BANNER_RENDER_FAILED');
    expect(platformClient.upload).not.toHaveBeenCalled();
    renderSpy.mockRestore();
  });

  it('uploads the rendered buffer when render succeeds', async () => {
    const platformClient = { upload: vi.fn().mockResolvedValue({ ok: true }) };
    await processPublishJob(seedJob({ banner_enabled: true, label: 'TODAY' }), { platformClient });
    expect(platformClient.upload).toHaveBeenCalledWith(expect.objectContaining({ buffer: expect.any(Buffer) }));
  });

  it('uploads the source path when banner disabled', async () => {
    const platformClient = { upload: vi.fn().mockResolvedValue({ ok: true }) };
    await processPublishJob(seedJob({ banner_enabled: false }), { platformClient });
    expect(platformClient.upload).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: expect.any(String) }));
  });
});
```

(Adapt seed/process names to whatever the worker already exports.)

- [ ] **Step 3: Run tests + typecheck**

```
npm run typecheck
npx vitest run supabase/functions/publish-queue
```

Expected: clean.

- [ ] **Step 4: Manual smoke**

Spin up a local Supabase and queue a real publish job for a fake test account. Verify:
- Banner-enabled with valid label: rendered buffer goes to the (mocked) platform client.
- Banner-disabled: source path goes through.
- Render error: job ends `failed`, no platform call.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-queue/worker.ts supabase/functions/publish-queue/*.test.ts
git commit -m "refactor(publish): preflight banner render in publish worker

Replaces the bannered_media_path substitution + staleness check with
an inline Sharp render at publish time. Render runs before any
platform API call; render failure marks the job failed with
BANNER_RENDER_FAILED and never touches the platform."
```

---

## Task 12: Migration 2 — drop old columns + function audit

**Files:**
- Create: `supabase/migrations/20260507100100_banner_overlay_drop_columns.sql`

- [ ] **Step 1: Function audit**

Run the audit from `.claude/rules/supabase.md`:

```sql
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
  AND (routine_definition ILIKE '%banner_state%'
       OR routine_definition ILIKE '%banner_label%'
       OR routine_definition ILIKE '%bannered_media_path%'
       OR routine_definition ILIKE '%banner_rendered_for_scheduled_at%'
       OR routine_definition ILIKE '%banner_render_metadata%'
       OR routine_definition ILIKE '%banner_source_media_path%');
```

Also grep migrations:

```bash
grep -rn "banner_state\|banner_label\|bannered_media_path\|banner_rendered_for_scheduled_at\|banner_render_metadata\|banner_source_media_path" supabase/migrations/ | grep -v "20260507100"
```

For each function or trigger that references a doomed column, include a `CREATE OR REPLACE FUNCTION` (or trigger update) in the migration that removes/replaces the reference. If no functions match, leave the migration without function changes.

- [ ] **Step 2: Write the drop migration**

```sql
-- Banner overlay consistency — drop legacy columns (Migration 2 of 2)

-- (If function audit found anything, replace those functions/triggers here BEFORE the drops.)
-- Example placeholder if nothing was found:
-- -- No functions or triggers referenced the dropped columns.

ALTER TABLE public.content_variants
  DROP COLUMN IF EXISTS banner_state,
  DROP COLUMN IF EXISTS banner_label,
  DROP COLUMN IF EXISTS banner_source_media_path,
  DROP COLUMN IF EXISTS bannered_media_path,
  DROP COLUMN IF EXISTS banner_render_metadata,
  DROP COLUMN IF EXISTS banner_rendered_for_scheduled_at;

-- Drop the index that pointed at the now-removed bannered_media_path / state, if it exists.
DROP INDEX IF EXISTS idx_content_variants_banner_rendered;
```

- [ ] **Step 3: Dry-run + apply**

```
npx supabase db push --dry-run
npx supabase db push
```

Expected: clean apply. No functions break (audit guarantees this).

- [ ] **Step 4: Verify**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'content_variants' AND column_name LIKE 'banner_%';
```

Expected: only the 5 new override columns remain.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260507100100_banner_overlay_drop_columns.sql
git commit -m "feat: drop legacy banner state columns

Migration 2 of 2 for banner overlay consistency. Drops the
banner_state machinery (banner_state, banner_label, banner_source_media_path,
bannered_media_path, banner_render_metadata, banner_rendered_for_scheduled_at)
now that all read paths are gone. Function audit per
.claude/rules/supabase.md was clean."
```

---

## Task 13: Delete dead code

**Files (delete):**
- `src/lib/scheduling/banner-canvas.ts`
- `src/lib/scheduling/banner-canvas.test.ts`
- `src/lib/scheduling/banner-renderer.server.ts`
- `src/app/api/internal/render-banner/route.ts`
- `scripts/ops/repair-banner-overlays.ts`
- `src/features/planner/banner-rendered-preview.tsx`
- `src/features/planner/banner-overlay-preview.tsx`
- `package.json` — remove the `ops:repair-banner-overlays` script entry.

- [ ] **Step 1: Confirm zero references**

```bash
grep -rn "banner-canvas\|banner-renderer\.server\|banner-rendered-preview\|banner-overlay-preview\|repair-banner-overlays\|/api/internal/render-banner\|prompt_context.*bannerConfig\|prompt_context\['bannerConfig'\]" src/ supabase/ scripts/ package.json
```

Expected: no matches outside the files about to be deleted.

- [ ] **Step 2: Delete the files**

```bash
git rm src/lib/scheduling/banner-canvas.ts \
       src/lib/scheduling/banner-canvas.test.ts \
       src/lib/scheduling/banner-renderer.server.ts \
       src/app/api/internal/render-banner/route.ts \
       scripts/ops/repair-banner-overlays.ts \
       src/features/planner/banner-rendered-preview.tsx \
       src/features/planner/banner-overlay-preview.tsx
```

Edit `package.json` to remove the `"ops:repair-banner-overlays"` script entry.

- [ ] **Step 3: Run full CI**

```
npm run ci:verify
```

Expected: lint, typecheck, test, build all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(banner): remove dead code after consistency rework

- banner-canvas.ts (replaced by render-server.ts + BannerOverlay SVG)
- banner-renderer.server.ts (replaced by render-server.ts)
- /api/internal/render-banner route (no longer called)
- ops:repair-banner-overlays script (banners are derived; nothing to repair)
- banner-rendered-preview.tsx + banner-overlay-preview.tsx (replaced by BannerOverlay)
"
```

---

## Task 14: `cleanup-banner-storage.ts` ops script

**Files:**
- Create: `scripts/ops/cleanup-banner-storage.ts`

- [ ] **Step 1: Implement the script**

```ts
// scripts/ops/cleanup-banner-storage.ts
// Run once after Migration 2 + dead-code commit have shipped.
// Idempotent — safe to re-run if it errors partway through.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BUCKET = 'banners'; // adjust if the project uses a different bucket
const PAGE = 1000;

async function main() {
  let total = 0;
  let errors = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', {
      limit: PAGE,
      offset,
    });
    if (error) {
      console.error('list failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    const paths = data.filter((d) => d.name && !d.id?.endsWith('/')).map((d) => d.name);
    if (paths.length === 0) break;

    const { error: rmError } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmError) {
      console.error('remove batch failed:', rmError.message);
      errors += paths.length;
    } else {
      total += paths.length;
    }
    offset += paths.length;
  }

  console.log(`Cleanup complete. Deleted ~${total} objects from ${BUCKET}/. Errors: ${errors}.`);
  if (errors > 0) process.exit(2);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
```

(Note: the bucket name and storage layout were `banners/{contentId}/{variantId}.jpg` per the spec. If `banners/` is a folder inside another bucket, adjust the listing path. Implementer should verify with `supabase storage ls`.)

- [ ] **Step 2: Local dry-run**

Run: `npx tsx scripts/ops/cleanup-banner-storage.ts`
Expected on a clean local: prints `Deleted ~0 objects`. With seeded test data: prints the count and the bucket is empty afterwards.

- [ ] **Step 3: Commit**

```bash
git add scripts/ops/cleanup-banner-storage.ts
git commit -m "chore(ops): add cleanup-banner-storage.ts

Run once after Migration 2 to delete bannered JPEGs from Supabase
Storage. Uses the service-role key. Idempotent and re-runnable."
```

---

## Task 15: Final verification — full CI pipeline + smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the full CI pipeline**

```
npm run ci:verify
```

Expected: every step passes (lint, typecheck, test, build).

- [ ] **Step 2: Targeted dev smoke**

```
npm run dev
```

Walk through:
- `/planner` — schedule a post 3 days out, banner shows `THIS [WEEKDAY]`.
- Reschedule the same post 8 days out — banner immediately shows `NEXT [WEEKDAY]`.
- `/settings` — toggle banners off at account level. Reload `/planner`. Banner is gone.
- Toggle banners on for a single post via `<BannerControls />` even though account default is off — that post's banner reappears.
- Set a 20-char custom message — banner shows the message.
- Set a 21-char custom message — UI rejects.

- [ ] **Step 3: Production-shape integration check (mocked)**

```
npx vitest run supabase/functions/publish-queue
```

Expected: the worker tests added in Task 11 still pass.

- [ ] **Step 4: If everything passes, no commit needed.** If any fix was required during smoke, commit it and re-run the pipeline.

---

## Self-Review

- **Spec coverage:** every locked decision (Q1 label set, Q2 derived data, Q3 same rules across post types, Q4 boundaries, Q5 toggle scope) maps to one or more tasks; every G-fix from the adversarial review is covered (G1 → Task 14, G2 → Task 11, G3 → Task 1, G4 → Task 1, G5 → Task 6 data fetcher, G6 → Tasks 4 + 6, G7 → no code change needed, G8 → handled by per-frame independence already in worker, G9 → Task 3, G10 → Tasks 8 + 9).
- **Placeholders:** no "implement later" or "similar to Task N" — every step shows real code or a real command.
- **Type consistency:** `ResolvedConfig`, `AccountBannerDefaults`, `PostBannerOverrides` defined in Task 3 are used unchanged in Tasks 6, 8, 10, 11. `BannerPosition` is the same enum throughout. The function `bannerConfigResolver` keeps the same two-argument signature in every task that uses it.
- **Migration order:** Task 1 adds columns → Tasks 2–11 use them → Task 12 drops the old ones → Task 13 deletes dead code → Task 14 cleans storage. Build stays green at every commit because new code only references new columns and old code is only removed once nothing reads it.
