import { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ConnectionHealthToast } from '@/features/connections/connection-toast';
import { signOut } from '@/lib/auth/actions';
import { getCurrentUser } from '@/lib/auth/server';
import { getConnectionHealthSummaries } from '@/lib/connections/health';
import { getUnreadNotificationCount } from '@/lib/planner/notifications';
import type { ConnectionHealthSummary } from '@/types/providers';

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * Protected layout for all (app)/* routes.
 * Gets the current user and redirects to login if unauthenticated.
 * Passes user to AuthProvider for client-side access.
 * Fetches connection health for sidebar dots and login toast (D-01, D-03).
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  // Authenticated but with no accessible brand -> dedicated empty state, not
  // the brand-scoped shell (whose queries all assume an active brand).
  if (!user.activeAccountId) {
    redirect('/no-access');
  }

  // Fetch connection health for sidebar dots and toast — silent fallback on error
  let healthSummaries: ConnectionHealthSummary[] = [];
  try {
    healthSummaries = await getConnectionHealthSummaries();
  } catch {
    // Silent fallback — no health dots or toast if query fails
  }

  // Fetch unread notification count for sidebar badge — silent fallback to 0
  let notificationCount = 0;
  try {
    notificationCount = await getUnreadNotificationCount();
  } catch {
    // Silent fallback — badge shows 0 if query fails
  }

  return (
    <AuthProvider value={user}>
      <AppShell
        healthSummaries={healthSummaries}
        notificationCount={notificationCount}
        signOutAction={signOut}
      >
        {children}
      </AppShell>
      <ConnectionHealthToast summaries={healthSummaries} />
    </AuthProvider>
  );
}
