# Phase 5: Realtime UX and Notifications - Research

**Researched:** 2026-05-19
**Domain:** Supabase Realtime, Playwright E2E, Web Performance, Email Notifications
**Confidence:** HIGH

## Summary

Phase 5 transforms the application from a static request-response model into a live-updating experience. The core technical challenges are: (1) wiring Supabase Realtime postgres_changes into the existing Next.js App Router architecture, (2) extending three existing cron jobs to cover the full notification routing matrix, (3) meeting Core Web Vitals performance budgets on the Planner page, (4) standing up Playwright from scratch for 6 E2E journeys, and (5) writing operational runbooks.

The codebase already has strong foundations: a `StatusDrawer` component ready for realtime feed injection, `listPlannerNotifications()` for notification history, three cron routes (`notify-failures`, `token-health`, `notify-expiring-connections`) that handle email delivery with idempotency via the `notifications` table, and a `PlannerSkeleton` Suspense fallback on the planner page.

**Primary recommendation:** Enable Supabase Realtime publication on `publish_jobs` and `notifications` tables via migration, build a `useRealtimeFeed` hook scoped by `account_id`, extend existing cron jobs for NOTIF-03/04 email routing, and set up Playwright with page object model fixtures for the 6 critical journeys.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Supabase Realtime subscription on `publish_jobs` and `notifications` tables -- status changes push to connected clients within 5 seconds
- **D-02:** Activity feed displays in existing planner sidebar/drawer area -- not a separate page
- **D-03:** Feed items show: event type icon, platform badge, plain-English message, relative timestamp, and a CTA link
- **D-04:** Realtime channel scoped per account_id -- single channel subscription per authenticated session
- **D-05:** Urgent events (publish failure, token expired/disconnected) -> email + in-app notification
- **D-06:** Non-urgent events (token expiring <=4 days, weekly summary) -> in-app notification only; email for token expiry at <=4 days per NOTIF-04
- **D-07:** Planner "Attention Needed" banner at top of planner view showing count of failed publishes
- **D-08:** Existing `notify-failures` cron and `token-health` cron are the email delivery mechanism -- extend, don't replace
- **D-09:** Notification preferences stored in `posting_defaults.notifications` JSONB
- **D-10:** Planner LCP <=2.5s with skeleton paint <=400ms -- Server Component data fetch + Suspense boundaries
- **D-11:** INP <200ms -- audit existing interactions, defer heavy work with startTransition
- **D-12:** Library lazy loading: first image row visible <=2000ms, remaining rows use intersection observer
- **D-13:** Lighthouse targets: Performance >=85, Accessibility >=95 on all primary routes
- **D-14:** Load test: 50 concurrent Planner requests -> p99 <500ms
- **D-15:** Playwright E2E suite covering 6 critical journeys
- **D-16:** @smoke tag on subset for CI gating; full suite runs on staging
- **D-17:** Staging environment uses MSW-based mock providers
- **D-18:** Three runbooks: token reconnection, publish outage, credential rotation

### Claude's Discretion
- Activity feed component design (list vs timeline vs card layout)
- Realtime reconnection/error handling strategy
- Exact Playwright test structure and page object model design
- Performance optimization techniques (bundle splitting, image optimization, font loading)
- Notification badge/count display in nav/sidebar
- Runbook format and level of detail
- Nonce-based CSP implementation (deferred from Phase 1)
- Load test tooling choice

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NOTIF-01 | Activity feed with Supabase Realtime (status updates within 5s, no refresh) | Supabase postgres_changes on publish_jobs + notifications tables; useRealtimeFeed hook; StatusDrawer component already exists |
| NOTIF-02 | In-app notifications for non-urgent events (token expiring soon, weekly summary) | notifications table with urgency enum; listPlannerNotifications() already reads from it; extend cron inserts |
| NOTIF-03 | Email notifications for urgent events (publish failure, token expired/disconnected) | notify-failures cron already sends failure emails; token-health cron needs email extension for expired tokens |
| NOTIF-04 | Token expiry: in-app notification + email sent when token expiring in <=4 days | notify-expiring-connections cron already handles 7-day window; narrow to 4-day trigger for email per NOTIF-04 |
| NOTIF-05 | Planner failure banner: "Attention Needed" count at top of view | Query publish_jobs where status='failed' and account_id matches; server component count + client realtime updates |
| PERF-01 | Planner LCP <=2.5s; skeleton paint <=400ms | PlannerSkeleton already exists; Suspense boundary in place; audit data fetch waterfall |
| PERF-02 | INP <200ms for all interactions | startTransition for non-urgent state updates; audit event handlers on planner calendar |
| PERF-04 | Library first image row visible <=2000ms; remaining rows lazy-loaded | Intersection Observer for below-fold images; next/image with priority on first row |
| PERF-05 | Lighthouse: Performance >=85, Accessibility >=95 on all primary routes | Lighthouse CI or manual audit; font loading, image optimization, a11y fixes |
| PERF-06 | Load test: 50 concurrent requests to Planner -> p99 <500ms | autocannon (Node.js native) for simplicity; script targeting /planner API |
| TEST-03 | Playwright E2E suite covering 6 critical journeys with @smoke tag for CI | New Playwright setup; page object model; 6 journeys per D-15 |
| INFRA-05 | Staging environment with mock providers for full regression | MSW mock server extending Phase 4 patterns; environment-specific config |
| INFRA-06 | Runbooks: token reconnection, publish outage, credential rotation | Markdown runbooks in docs/ or .planning/runbooks/ |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | ^2.89.0 (installed) | Realtime postgres_changes subscription | Already installed; Realtime built into the client |
| @playwright/test | 1.60.0 | E2E testing framework | Official Next.js recommendation; best DX for App Router |
| autocannon | 8.0.0 | HTTP load testing | Node.js native, zero config, perfect for p99 measurement |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @playwright/test (chromium) | bundled | Browser engine for E2E | Installed via `npx playwright install chromium` |
| lighthouse | 13.3.0 | Performance/accessibility auditing | Optional CLI for manual PERF-05 verification |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| autocannon | k6 | k6 is more powerful but requires Go runtime; autocannon is Node-native and sufficient for 50-connection test |
| Lighthouse CLI | Lighthouse CI (LHCI) | LHCI adds GitHub Actions integration but is heavier; CLI sufficient for manual verification |

**Installation:**
```bash
npm install -D @playwright/test autocannon
npx playwright install chromium
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  hooks/
    use-realtime-feed.ts          # Supabase Realtime subscription hook
  features/
    planner/
      activity-feed.tsx           # Feed component rendered inside StatusDrawer
      activity-feed-item.tsx      # Individual feed item with icon/badge/CTA
      attention-needed-banner.tsx  # Failed publish count banner (NOTIF-05)
  lib/
    notifications/
      routing.ts                  # Shared urgency routing logic
      insert.ts                   # Helper to insert notifications with correct schema
  components/
    layout/
      notification-badge.tsx      # Unread count badge in sidebar/nav
e2e/
  fixtures/
    auth.fixture.ts              # Shared auth state setup
    page-objects/
      planner.page.ts            # Planner page object
      create-post.page.ts        # Create post page object
      settings.page.ts           # Settings page object
      connections.page.ts        # Connections page object
      login.page.ts              # Login page object
  tests/
    smoke/
      sign-in.spec.ts            # @smoke tagged
      create-post.spec.ts        # @smoke tagged
      planner-nav.spec.ts        # @smoke tagged
    full/
      schedule-publish.spec.ts
      connect-platform.spec.ts
      settings-brand.spec.ts
playwright.config.ts
scripts/
  load-test-planner.ts           # autocannon script for PERF-06
docs/
  runbooks/
    token-reconnection.md
    publish-outage.md
    credential-rotation.md
```

### Pattern 1: Supabase Realtime Subscription in Next.js App Router

**What:** Server Component fetches initial data, Client Component subscribes to realtime changes and merges them.
**When to use:** Activity feed (NOTIF-01), failure count (NOTIF-05).

```typescript
// src/hooks/use-realtime-feed.ts
'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

interface FeedEvent {
  id: string;
  type: 'publish_success' | 'publish_failure' | 'token_expiry' | 'connection_change';
  platform: string;
  message: string;
  timestamp: string;
  resourceId?: string;
}

export function useRealtimeFeed(accountId: string, initialEvents: FeedEvent[]) {
  const [events, setEvents] = useState<FeedEvent[]>(initialEvents);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel(`activity-feed:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'publish_jobs',
          filter: `account_id=eq.${accountId}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          // Transform DB change into feed event
          const newEvent = mapPublishJobToFeedEvent(payload);
          if (newEvent) {
            setEvents((prev) => [newEvent, ...prev].slice(0, 50));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `account_id=eq.${accountId}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const newEvent = mapNotificationToFeedEvent(payload);
          if (newEvent) {
            setEvents((prev) => [newEvent, ...prev].slice(0, 50));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return events;
}
```

### Pattern 2: Realtime-Updated Failure Count

**What:** Server Component renders initial count, Client Component subscribes to publish_jobs changes and updates count.
**When to use:** NOTIF-05 "Attention Needed" banner.

```typescript
// Server component provides initial count
const failedCount = await getFailedPublishCount(accountId);

// Client component subscribes to changes
function AttentionNeededBanner({ accountId, initialCount }: Props) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`failures:${accountId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'publish_jobs',
        filter: `account_id=eq.${accountId}`,
      }, (payload) => {
        if (payload.new.status === 'failed') setCount((c) => c + 1);
        if (payload.old?.status === 'failed' && payload.new.status !== 'failed') {
          setCount((c) => Math.max(0, c - 1));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [accountId]);

  if (count === 0) return null;
  return <Banner variant="warning">{count} post(s) need attention</Banner>;
}
```

### Pattern 3: Playwright Page Object with Fixtures

**What:** Page objects encapsulate selectors; fixtures provide reusable auth state.
**When to use:** All 6 E2E journeys.

```typescript
// e2e/fixtures/auth.fixture.ts
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/auth/sign-in');
    await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL!);
    await page.getByRole('button', { name: 'Send magic link' }).click();
    // In staging, magic link auto-resolves via test helper
    await page.waitForURL('/planner');
    await use(page);
  },
});

// e2e/fixtures/page-objects/planner.page.ts
export class PlannerPage {
  constructor(private page: Page) {}

  async navigateToMonth(month: string) {
    await this.page.goto(`/planner?month=${month}`);
  }

  async getAttentionNeededCount() {
    const banner = this.page.getByTestId('attention-needed-banner');
    if (await banner.isVisible()) {
      return parseInt(await banner.textContent() ?? '0');
    }
    return 0;
  }
}
```

### Anti-Patterns to Avoid

- **Polling for realtime data:** The existing `/api/planner/activity` polling endpoint must be replaced, not run alongside Realtime. Two data paths create race conditions and double renders.
- **Subscribing to all rows:** Always filter by `account_id` in the Realtime filter. Without it, the client receives every change across all accounts (RLS only filters at the Postgres level, but events are still transmitted over the wire and filtered client-side).
- **Mocking server actions in Playwright:** With App Router, server actions run on the server. Mock at the service boundary (MSW for external APIs) not at the action level.
- **Building a custom WebSocket layer:** Supabase Realtime handles connection management, reconnection, and heartbeats. Do not hand-roll WebSocket code.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket connections | Custom ws/Socket.IO server | Supabase Realtime (postgres_changes) | Handles reconnection, heartbeats, auth, RLS filtering |
| Email delivery | SMTP client | Resend via existing sendEmail() | Already built with error handling and env-safe fallback |
| Load testing | Custom HTTP bombardier | autocannon | Mature tool, reports p99/p50/avg, zero config |
| E2E browser automation | Custom Puppeteer scripts | Playwright | Auto-waits, network interception, parallel execution, CI-friendly |
| Notification idempotency | Custom dedup logic | Existing notifications table pattern | Cron jobs already use category + metadata JSONB filter for dedup |

**Key insight:** The existing codebase has 80% of the notification infrastructure built. The primary work is wiring Realtime subscriptions, extending cron email routing, and building the UI feed component -- not creating new backend systems.

## Common Pitfalls

### Pitfall 1: Notifications Table Schema Mismatch

**What goes wrong:** Code uses `message` and `metadata` columns but the migration (`00000000000003_notifications.sql`) defines `title` and `body` with no `message` or `metadata` columns.
**Why it happens:** The schema was designed with `title`/`body` but implementation code adopted `message`/`metadata` without a corresponding migration.
**How to avoid:** Phase 5 MUST include a migration that either: (a) adds `message text` and `metadata jsonb` columns, or (b) renames code references to use `title`/`body`. Given that 4+ code files already use `message`/`metadata`, the migration approach is safer.
**Warning signs:** `isSchemaMissingError()` catch blocks silently swallow this in dev -- the feature appears to work but notifications are never actually stored.

### Pitfall 2: Supabase Realtime Not Enabled on Tables

**What goes wrong:** Subscribing to postgres_changes returns no events.
**Why it happens:** Tables must be added to the `supabase_realtime` publication. No existing migration does this.
**How to avoid:** Add migration: `ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_jobs; ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;`
**Warning signs:** Subscription connects successfully (no error) but no events arrive.

### Pitfall 3: REPLICA IDENTITY Required for UPDATE/DELETE Events

**What goes wrong:** UPDATE events on `publish_jobs` don't include the `old` record (previous state), making it impossible to detect status transitions.
**Why it happens:** Default REPLICA IDENTITY is `DEFAULT` which only includes the primary key in the `old` payload.
**How to avoid:** Add migration: `ALTER TABLE public.publish_jobs REPLICA IDENTITY FULL;` This sends the full old row with UPDATE events, enabling status transition detection.
**Warning signs:** `payload.old` only contains `{ id: '...' }` instead of the full row.

### Pitfall 4: RLS Silently Filters Realtime Events

**What goes wrong:** Realtime subscription receives no events even though data is changing.
**Why it happens:** postgres_changes respects RLS policies. The anon-key client must have a valid session with a JWT that satisfies the `auth.uid()` check in RLS policies.
**How to avoid:** Ensure the browser Supabase client is authenticated (user session active) before subscribing. The existing `createBrowserSupabaseClient()` uses cookies for auth, which should work if the user is logged in.
**Warning signs:** Subscription is active but receives zero events; switching to service-role client fixes it (confirms RLS issue).

### Pitfall 5: Playwright Auth in App Router

**What goes wrong:** E2E tests can't authenticate because magic link flow requires email delivery.
**Why it happens:** CheersAI uses magic link as primary auth; no way to click email links in Playwright.
**How to avoid:** For staging/E2E, either (a) use the password fallback auth (already exists as hidden fallback), or (b) create a test-only API endpoint that generates a session for a test user (guarded by `E2E_TEST_SECRET` env var). Option (a) is simpler and already available.
**Warning signs:** Tests hang waiting for email delivery that never arrives.

### Pitfall 6: Lighthouse Scores Measured Wrong

**What goes wrong:** Lighthouse scores vary wildly between runs, leading to flaky CI.
**Why it happens:** Lighthouse is sensitive to machine load, network conditions, and concurrent processes.
**How to avoid:** Run Lighthouse against a local production build (`npm run build && npm start`), use `--only-categories=performance,accessibility`, run 3 times and take median. For CI, use assertions with margin (target 85 but assert >= 80).
**Warning signs:** Scores fluctuate 15+ points between runs.

### Pitfall 7: Notification Insert RLS Blocks Cron Jobs

**What goes wrong:** Cron jobs that insert notifications fail because they use service-role client but the notifications table RLS INSERT policy checks `auth.uid()`.
**Why it happens:** The `notifications_insert` policy has `WITH CHECK (account_id = (SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()))`. Service-role clients bypass RLS entirely, so this is actually fine -- but important to verify.
**How to avoid:** Cron jobs already use `tryCreateServiceSupabaseClient()` which bypasses RLS. Ensure all system notification inserts go through service-role, not anon-key.
**Warning signs:** 403 errors or silent insert failures from cron endpoints.

## Code Examples

### Enabling Realtime Publication (Migration)

```sql
-- Source: Supabase docs - postgres-changes setup
-- Migration: 00000000000008_realtime_and_notification_fix.sql

-- 1. Fix notifications schema mismatch
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- 2. Enable Realtime on publish_jobs and notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- 3. Enable FULL replica identity for status transition detection
ALTER TABLE public.publish_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
```

### Activity Feed Item Component

```typescript
// Source: Project patterns (StatusDrawer, status chips)
interface ActivityFeedItemProps {
  type: 'publish_success' | 'publish_failure' | 'token_expiry' | 'connection_change';
  platform: string;
  message: string;
  timestamp: string;
  ctaHref?: string;
  ctaLabel?: string;
}

function ActivityFeedItem({ type, platform, message, timestamp, ctaHref, ctaLabel }: ActivityFeedItemProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <EventTypeIcon type={type} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={platform} />
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(timestamp)}
          </span>
        </div>
        <p className="mt-1 text-sm text-foreground">{message}</p>
        {ctaHref && (
          <a href={ctaHref} className="mt-1 text-xs font-medium text-brand-teal hover:underline">
            {ctaLabel}
          </a>
        )}
      </div>
    </div>
  );
}
```

### autocannon Load Test Script

```typescript
// scripts/load-test-planner.ts
import autocannon from 'autocannon';

const result = await autocannon({
  url: `${process.env.BASE_URL ?? 'http://localhost:3000'}/planner`,
  connections: 50,
  duration: 30, // seconds
  headers: {
    cookie: process.env.E2E_AUTH_COOKIE ?? '',
  },
});

console.log(`p99 latency: ${result.latency.p99}ms`);
console.log(`Target: <500ms | Result: ${result.latency.p99 < 500 ? 'PASS' : 'FAIL'}`);
```

### Playwright Config

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  grep: process.env.CI ? /@smoke/ : undefined,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling `/api/planner/activity` | Supabase Realtime postgres_changes | Phase 5 | Eliminates 5s polling interval; instant updates |
| No E2E tests | Playwright E2E suite | Phase 5 | 6 critical journeys with CI @smoke gating |
| Console-only token warnings | Email + in-app notifications | Phase 5 | Proactive alerting before publishing failures |
| No performance budgets | LCP/INP/Lighthouse targets | Phase 5 | Measurable, enforceable performance standards |

**Deprecated/outdated:**
- `/api/planner/activity` polling endpoint: Replace with Realtime subscription. Consider adding tombstone (410 Gone) per Phase 4 pattern.

## Open Questions

1. **Notifications schema alignment**
   - What we know: Migration defines `title`/`body`; code uses `message`/`metadata`. The `isSchemaMissingError()` catch blocks silently mask this.
   - What's unclear: Whether the live database has already been manually patched with these columns (possible if Phase 4 ran ops scripts against it).
   - Recommendation: Include a migration that adds `message` and `metadata` columns with `IF NOT EXISTS` guards. Safe either way.

2. **E2E auth strategy**
   - What we know: CheersAI uses magic link as primary auth. Password fallback exists but is hidden in UI.
   - What's unclear: Whether a test user with password auth is set up in staging.
   - Recommendation: Use password fallback for E2E tests. Create a seed script that provisions a test user with known password credentials.

3. **Nonce-based CSP (deferred from Phase 1)**
   - What we know: Phase 1 used static CSP with `unsafe-inline` for styles. Phase 5 CONTEXT lists nonce-based CSP as Claude's discretion.
   - What's unclear: Whether this should block other work or be a separate task.
   - Recommendation: Implement as a standalone task at the end of the phase. It's a security hardening improvement, not a functional requirement.

## Sources

### Primary (HIGH confidence)
- Supabase Realtime postgres-changes docs: https://supabase.com/docs/guides/realtime/postgres-changes
- Supabase Realtime with Next.js guide: https://supabase.com/docs/guides/realtime/realtime-with-nextjs
- Supabase Realtime authorization docs: https://supabase.com/docs/guides/realtime/authorization
- Next.js Playwright testing guide: https://nextjs.org/docs/app/guides/testing/playwright
- Playwright Page Object Model docs: https://playwright.dev/docs/pom
- Existing codebase: `src/app/api/cron/notify-failures/route.ts`, `src/app/api/cron/token-health/route.ts`, `src/components/layout/status-drawer.tsx`

### Secondary (MEDIUM confidence)
- Supabase Realtime publication setup: https://github.com/orgs/supabase/discussions/13680
- Supabase Realtime RLS troubleshooting: https://www.technetexperts.com/realtime-rls-solved/
- Next.js Core Web Vitals optimization: https://eastondev.com/blog/en/posts/dev/20251219-nextjs-core-web-vitals/
- Playwright E2E with MSW and Next.js: https://safedep.io/end-to-end-test-nextjs-msw-playwright/

### Tertiary (LOW confidence)
- autocannon load test patterns: community articles (verified via npm registry version 8.0.0)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Supabase Realtime is built into the installed client; Playwright is the official Next.js recommendation
- Architecture: HIGH - Patterns derived from official docs and existing codebase patterns
- Pitfalls: HIGH - Schema mismatch verified by direct code inspection; Realtime publication requirement confirmed by official docs
- Performance: MEDIUM - LCP/INP optimization is well-documented but achieving specific thresholds depends on actual data volume and component complexity

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (stable domain; Supabase Realtime API is mature)
