import { beforeEach, describe, expect, it, vi } from 'vitest';

// getAdminOverview reads every brand and user with the service-role client.
// admin/layout.tsx gates /admin, but a layout renders in parallel with its
// page, so the page must gate itself before that read.

const mocks = vi.hoisted(() => ({
  requireAuthContext: vi.fn(),
  getAdminOverview: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/server', () => ({ requireAuthContext: mocks.requireAuthContext }));
vi.mock('@/lib/admin/data', () => ({ getAdminOverview: mocks.getAdminOverview }));
vi.mock('@/app/(app)/admin/admin-client', () => ({ AdminClient: () => null }));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://cheers.example.test' } } }));

import AdminPage from '@/app/(app)/admin/page';

describe('AdminPage gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminOverview.mockResolvedValue({ brands: [], users: [] });
  });

  it('redirects a signed-out visitor before reading any brand or user', async () => {
    mocks.requireAuthContext.mockRejectedValue(new Error('NEXT_REDIRECT:/auth/login'));

    await expect(AdminPage()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
    expect(mocks.getAdminOverview).not.toHaveBeenCalled();
  });

  it('redirects a brand member who is not a super-admin before the read', async () => {
    mocks.requireAuthContext.mockResolvedValue({ accountId: 'account-1', isSuperAdmin: false });

    await expect(AdminPage()).rejects.toThrow('NEXT_REDIRECT:/planner');
    expect(mocks.getAdminOverview).not.toHaveBeenCalled();
  });

  it('loads the overview for a super-admin', async () => {
    mocks.requireAuthContext.mockResolvedValue({ accountId: 'account-1', isSuperAdmin: true });

    await AdminPage();

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getAdminOverview).toHaveBeenCalledTimes(1);
  });
});
