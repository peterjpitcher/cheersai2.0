import { beforeEach, describe, expect, it, vi } from 'vitest';

// getAdminOverview reads every brand and user with the service-role client,
// and loadSignupsOverview reads the self-serve sign-up funnel and lists.
// admin/layout.tsx gates /admin, but a layout renders in parallel with its
// page, so the page must gate itself before either read.

const mocks = vi.hoisted(() => ({
  requireAuthContext: vi.fn(),
  getAdminOverview: vi.fn(),
  loadSignupsOverview: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: mocks.requireAuthContext }));
vi.mock('@/lib/admin/data', () => ({ getAdminOverview: mocks.getAdminOverview }));
vi.mock('@/app/(app)/admin/admin-client', () => ({ AdminClient: () => null }));
vi.mock('@/lib/signup/admin-overview', () => ({ loadSignupsOverview: mocks.loadSignupsOverview }));
vi.mock('@/features/admin/signups-card', () => ({ SignupsCardSection: () => null, SignupsCardSkeleton: () => null }));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.example.test' } } }));

import AdminPage from '@/app/(app)/admin/page';

describe('AdminPage gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminOverview.mockResolvedValue({ brands: [], users: [] });
    mocks.loadSignupsOverview.mockResolvedValue({ status: 'error', message: 'x', readAt: '2026-09-28T09:30:00.000Z' });
  });

  it('redirects a signed-out visitor before reading any brand or user', async () => {
    mocks.requireAuthContext.mockRejectedValue(new Error('NEXT_REDIRECT:/auth/login'));

    await expect(AdminPage()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
    expect(mocks.getAdminOverview).not.toHaveBeenCalled();
    expect(mocks.loadSignupsOverview).not.toHaveBeenCalled();
  });

  it('redirects a brand member who is not a super-admin before the read', async () => {
    mocks.requireAuthContext.mockResolvedValue({ accountId: 'account-1', isSuperAdmin: false });

    await expect(AdminPage()).rejects.toThrow('NEXT_REDIRECT:/planner');
    expect(mocks.getAdminOverview).not.toHaveBeenCalled();
    expect(mocks.loadSignupsOverview).not.toHaveBeenCalled();
  });

  it('loads the overview for a super-admin', async () => {
    mocks.requireAuthContext.mockResolvedValue({ accountId: 'account-1', isSuperAdmin: true });

    await AdminPage();

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getAdminOverview).toHaveBeenCalledTimes(1);
    expect(mocks.loadSignupsOverview).toHaveBeenCalledTimes(1);
  });

  it('hands the Sign-ups card its reads without waiting for them', async () => {
    mocks.requireAuthContext.mockResolvedValue({ accountId: 'account-1', isSuperAdmin: true });
    let finish: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    mocks.loadSignupsOverview.mockReturnValue(pending);

    // The page renders even though the sign-up reads have not finished; the card streams in later.
    const page = (await AdminPage()) as { props: { children: Array<{ props: Record<string, unknown> }> } };
    const client = page.props.children[1];
    expect(client.props.signupsCard).toBeTruthy();
    finish({ status: 'error', message: 'x', readAt: '2026-09-28T09:30:00.000Z' });
  });
});
