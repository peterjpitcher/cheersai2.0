import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase/server';

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Public layout for auth pages (login, signup, password reset).
 * If user is already authenticated, redirect to dashboard.
 * No AppShell or sidebar; the page owns its public-facing layout.
 */
export default async function AuthLayout({ children }: AuthLayoutProps) {
  // Check if user is already logged in -- redirect to dashboard
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/planner');
  }

  return children;
}
