import { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ConnectionHealthToast } from '@/features/connections/connection-toast';
import { getCurrentUser } from '@/lib/auth/server';
import { getConnectionHealthSummaries } from '@/lib/connections/health';
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

  // Fetch connection health for sidebar dots and toast — silent fallback on error
  let healthSummaries: ConnectionHealthSummary[] = [];
  try {
    healthSummaries = await getConnectionHealthSummaries();
  } catch {
    // Silent fallback — no health dots or toast if query fails
  }

  return (
    <AuthProvider value={user}>
      <AppShell healthSummaries={healthSummaries}>{children}</AppShell>
      <ConnectionHealthToast summaries={healthSummaries} />
    </AuthProvider>
  );
}
