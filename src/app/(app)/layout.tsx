import { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider } from '@/components/providers/auth-provider';
import { getCurrentUser } from '@/lib/auth/server';

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * Protected layout for all (app)/* routes.
 * Gets the current user and redirects to login if unauthenticated.
 * Passes user to AuthProvider for client-side access.
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <AuthProvider value={user}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
