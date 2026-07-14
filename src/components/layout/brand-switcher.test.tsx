// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { AuthProvider } from '@/components/providers/auth-provider';
import type { AppUser } from '@/lib/auth/types';

const mockSwitch = vi.fn();
vi.mock('@/lib/auth/actions', () => ({
  switchActiveBrand: (id: string) => mockSwitch(id),
}));

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { BrandSwitcher } from '@/components/layout/brand-switcher';

function makeUser(brands: AppUser['brands'], activeAccountId: string | null): AppUser {
  return {
    id: 'user-1',
    email: 'owner@pub.com',
    accountId: activeAccountId,
    activeAccountId,
    businessName: brands.find((b) => b.accountId === activeAccountId)?.name ?? null,
    timezone: 'Europe/London',
    brands,
    isSuperAdmin: false,
  };
}

function renderSwitcher(user: AppUser) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider value={user}>
        <BrandSwitcher />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('BrandSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSwitch.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a plain label with no menu for a single brand', () => {
    renderSwitcher(
      makeUser([{ accountId: 'a-1', name: 'The Anchor', timezone: 'Europe/London' }], 'a-1'),
    );
    expect(screen.getByText('The Anchor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /switch brand/i })).not.toBeInTheDocument();
  });

  it('opens a listbox and switches brand on selection', async () => {
    renderSwitcher(
      makeUser(
        [
          { accountId: 'a-1', name: 'Alpha', timezone: 'Europe/London' },
          { accountId: 'a-2', name: 'Bravo', timezone: 'Europe/London' },
        ],
        'a-1',
      ),
    );

    const trigger = screen.getByRole('button', { name: /active brand: alpha\. switch brand/i });
    fireEvent.click(trigger);

    const option = screen.getByRole('option', { name: /bravo/i });
    fireEvent.click(option.querySelector('button')!);

    await waitFor(() => expect(mockSwitch).toHaveBeenCalledWith('a-2'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('does not call switch when the active brand is re-selected', async () => {
    renderSwitcher(
      makeUser(
        [
          { accountId: 'a-1', name: 'Alpha', timezone: 'Europe/London' },
          { accountId: 'a-2', name: 'Bravo', timezone: 'Europe/London' },
        ],
        'a-1',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /switch brand/i }));
    fireEvent.click(screen.getByRole('option', { name: /alpha/i }).querySelector('button')!);

    expect(mockSwitch).not.toHaveBeenCalled();
  });
});
