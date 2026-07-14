import { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { requireAuthContext } from '@/lib/auth/server';

/**
 * Super-admin gate for /admin/*. requireAuthContext already handles
 * unauthenticated (-> /auth/login) and zero-brand (-> /no-access); here we
 * additionally require the global super-admin flag.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { isSuperAdmin } = await requireAuthContext();
  if (!isSuperAdmin) {
    redirect('/planner');
  }
  return <>{children}</>;
}
