import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { SetPasswordForm } from './set-password-form';

/**
 * Landing page after an invite or password reset link. The person pressed
 * "Confirm and continue" on `/auth/confirm`, which verified the link and signed
 * them in, so a missing session here means the link expired or the session was lost.
 */
export default async function SetPasswordPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?error=link_expired');
  }

  return (
    <AuthCard title="Choose your password" description={`For ${user.email ?? 'your account'}. Use at least 12 characters.`}>
      <SetPasswordForm />
    </AuthCard>
  );
}
