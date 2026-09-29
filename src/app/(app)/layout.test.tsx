import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The (app) layout's sidebar extras (connection health dots and the
// notification badge) fall back quietly when their lookup fails. Both lookups
// re-check sign-in through requireAuthContext(), which redirects by throwing,
// and that redirect must not be mistaken for a failed lookup.

const USER = { id: 'u1', email: 'owner@example.com', activeAccountId: 'a1', accountId: 'a1', brands: [], features: {} };
const mockUser = vi.fn(async (): Promise<Record<string, unknown> | null> => USER);
const mockHealth = vi.fn(async (): Promise<unknown[]> => []);
const mockCount = vi.fn(async (): Promise<number> => 0);

vi.mock('@/lib/auth/server', () => ({ getCurrentUser: () => mockUser() }));
vi.mock('@/lib/connections/health', () => ({ getConnectionHealthSummaries: () => mockHealth() }));
vi.mock('@/lib/planner/notifications', () => ({ getUnreadNotificationCount: () => mockCount() }));
vi.mock('@/lib/team/invitations', () => ({ INVITATIONS_PATH: '/invitations', listPendingInvitationsForUser: async () => [] }));
vi.mock('@/lib/billing/enforcement', () => ({ isBillingEnforcementEnabled: async () => false }));
vi.mock('@/lib/billing/entitlement-server', () => ({ ENTITLEMENT_MESSAGES: {}, getBrandEntitlement: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: () => ({}) }));
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: () => null }));
vi.mock('@/components/providers/auth-provider', () => ({ AuthProvider: () => null }));
vi.mock('@/features/connections/connection-toast', () => ({ ConnectionHealthToast: () => null }));

const { default: AppLayout } = await import('@/app/(app)/layout');

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

/** What requireAuthContext() throws when the session has ended: Next's real redirect signal. */
function signInRedirect(): unknown {
  try {
    redirect('/auth/login');
  } catch (error) {
    return error;
  }
  throw new Error('redirect() did not throw');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue(USER);
  mockHealth.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe('(app) layout sidebar lookups', () => {
  it.each([
    ['connection health', () => mockHealth],
    ['notification count', () => mockCount],
  ])('lets a sign-in redirect from the %s lookup through', async (_lookup, lookup) => {
    const signal = signInRedirect();
    (lookup() as ReturnType<typeof vi.fn>).mockRejectedValue(signal);

    await expect(AppLayout({ children: null })).rejects.toBe(signal);
  });

  it('still falls back quietly when a lookup fails for any other reason', async () => {
    mockHealth.mockRejectedValue(new Error('social_connections lookup failed'));
    mockCount.mockRejectedValue(new Error('notifications lookup failed'));

    const shell = findComponent(await AppLayout({ children: null }), 'AppShell');

    expect(shell?.props.healthSummaries).toEqual([]);
    expect(shell?.props.notificationCount).toBe(0);
  });
});
