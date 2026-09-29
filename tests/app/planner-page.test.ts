import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The planner page must resolve the active brand itself before any query. The
// (app) layout's redirect does not protect it: layouts and pages render in
// parallel, and a signed-out visit used to query content_items with
// account_id=eq. (Postgres 22P02). These tests pin the page-level gate.

const mocks = vi.hoisted(() => ({
  requireAuthContext: vi.fn(),
  getCurrentUser: vi.fn(),
  getContentForCalendar: vi.fn(),
  getContentByAccount: vi.fn(),
  resolveThumbnails: vi.fn(),
  getFailedPublishCount: vi.fn(),
  listPlannerNotifications: vi.fn(),
  listActiveFailedPosts: vi.fn(),
  getSetupProgress: vi.fn(),
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthContext: mocks.requireAuthContext,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('@/lib/content/queries', () => ({
  getContentForCalendar: mocks.getContentForCalendar,
  getContentByAccount: mocks.getContentByAccount,
}));
vi.mock('@/lib/media/resolve-thumbnails', () => ({ resolveThumbnails: mocks.resolveThumbnails }));
vi.mock('@/lib/planner/notifications', () => ({
  getFailedPublishCount: mocks.getFailedPublishCount,
  listPlannerNotifications: mocks.listPlannerNotifications,
  listActiveFailedPosts: mocks.listActiveFailedPosts,
}));
vi.mock('@/lib/onboarding/setup-progress', () => ({ getSetupProgress: mocks.getSetupProgress }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: mocks.createServiceSupabaseClient,
}));
vi.mock('@/features/planner/planner-skeleton', () => ({ PlannerSkeleton: () => null }));
vi.mock('@/features/planner/attention-needed-banner', () => ({ AttentionNeededBanner: () => null }));
vi.mock('@/features/planner/planner-shell', () => ({ PlannerShell: () => null }));
vi.mock('@/features/planner/setup-checklist', () => ({ SetupChecklist: () => null }));

import PlannerPage from '@/app/(app)/planner/page';

const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222';

type AnyElement = ReactElement<Record<string, unknown>>;

/** Depth-first search of a server-component element tree for a named component. */
function findComponent(node: unknown, name: string): AnyElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findComponent(child, name);
      if (found) return found;
    }
    return null;
  }
  const element = node as AnyElement;
  if (typeof element.type === 'function' && element.type.name === name) return element;
  return findComponent(element.props?.children, name);
}

function expectNoBrandQueries() {
  expect(mocks.getContentForCalendar).not.toHaveBeenCalled();
  expect(mocks.getContentByAccount).not.toHaveBeenCalled();
  expect(mocks.resolveThumbnails).not.toHaveBeenCalled();
  expect(mocks.getSetupProgress).not.toHaveBeenCalled();
  expect(mocks.getFailedPublishCount).not.toHaveBeenCalled();
  expect(mocks.listPlannerNotifications).not.toHaveBeenCalled();
}

describe('PlannerPage brand resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A signed-out user: the old page read this and fell back to a blank id.
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getContentForCalendar.mockResolvedValue([]);
    mocks.getContentByAccount.mockResolvedValue([]);
    mocks.resolveThumbnails.mockResolvedValue(new Map());
    mocks.getFailedPublishCount.mockResolvedValue(0);
    mocks.listPlannerNotifications.mockResolvedValue([]);
    mocks.listActiveFailedPosts.mockResolvedValue([]);
    mocks.getSetupProgress.mockResolvedValue(null);
    mocks.createServiceSupabaseClient.mockReturnValue({});
  });

  it.each([
    ['signed out', '/auth/login'],
    ['signed in with no brand', '/no-access'],
  ])('redirects before any brand query when %s', async (_state, target) => {
    mocks.requireAuthContext.mockRejectedValue(new Error(`NEXT_REDIRECT:${target}`));

    await expect(PlannerPage({})).rejects.toThrow(`NEXT_REDIRECT:${target}`);

    expectNoBrandQueries();
  });

  it('scopes every planner query to the resolved active brand', async () => {
    mocks.requireAuthContext.mockResolvedValue({ accountId: ACCOUNT_ID, role: 'owner' });

    const page = await PlannerPage({});
    const loader = findComponent(page, 'PlannerCalendarLoader');
    expect(loader).not.toBeNull();
    expect(loader!.props.accountId).toBe(ACCOUNT_ID);

    // Render the streamed calendar loader, where the content queries run.
    const render = loader!.type as (props: Record<string, unknown>) => Promise<unknown>;
    await render(loader!.props);

    expect(mocks.getContentForCalendar).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.any(String),
      expect.any(String),
    );
    expect(mocks.getContentByAccount).toHaveBeenCalledWith(ACCOUNT_ID, {
      status: ['scheduled', 'approved', 'draft'],
    });
    expect(mocks.getSetupProgress).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });
});

describe('PlannerPage attention lookups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthContext.mockResolvedValue({ accountId: ACCOUNT_ID, role: 'owner' });
    mocks.getFailedPublishCount.mockResolvedValue(3);
    mocks.listPlannerNotifications.mockResolvedValue([]);
    mocks.listActiveFailedPosts.mockResolvedValue([]);
    mocks.getSetupProgress.mockResolvedValue(null);
    mocks.createServiceSupabaseClient.mockReturnValue({});
  });

  /** What requireAuthContext() throws when the session has ended: Next's real redirect signal. */
  function signInRedirect(): unknown {
    try {
      redirect('/auth/login');
    } catch (error) {
      return error;
    }
    throw new Error('redirect() did not throw');
  }

  it.each([
    ['the failed-post count', () => mocks.getFailedPublishCount],
    ['the notifications feed', () => mocks.listPlannerNotifications],
    ['the failed-post list', () => mocks.listActiveFailedPosts],
  ])('lets a sign-in redirect from %s through instead of falling back', async (_lookup, lookup) => {
    const signal = signInRedirect();
    lookup().mockRejectedValue(signal);

    await expect(PlannerPage({ searchParams: Promise.resolve({ status: 'failed' }) })).rejects.toBe(signal);
  });

  it('shows plain words in the failed-post list, never Meta\'s own text', async () => {
    // Stored by the publish-queue edge function (live format, trace id replaced).
    const metaText =
      "[instagram_create_container] status=400 OAuthException: The aspect ratio is not supported. (code 36003, subcode 2207009) trace=AbC123";
    mocks.listActiveFailedPosts.mockResolvedValue([
      {
        id: 'content-1',
        platform: 'instagram',
        placement: 'feed',
        scheduledFor: '2026-10-03T11:00:00.000Z',
        lastError: metaText,
        lastAttemptedAt: '2026-10-03T11:01:00.000Z',
      },
    ]);

    const page = await PlannerPage({ searchParams: Promise.resolve({ status: 'failed' }) });
    const list = findComponent(page, 'FailedPostsList');
    expect(list).not.toBeNull();
    const html = renderToStaticMarkup(list!);

    expect(html).toContain('Instagram could not use the image on this post.');
    expect(html).not.toContain('OAuthException');
    expect(html).not.toContain('36003');
    expect(html).not.toContain('trace=');
  });

  it('still falls back quietly when a lookup fails for any other reason', async () => {
    mocks.getFailedPublishCount.mockRejectedValue(new Error('publish_jobs lookup failed'));
    mocks.listPlannerNotifications.mockRejectedValue(new Error('notifications lookup failed'));

    const page = await PlannerPage({});

    expect(findComponent(page, 'AttentionNeededBanner')?.props.initialCount).toBe(0);
  });
});
