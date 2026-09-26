import type { ReactElement } from 'react';
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
