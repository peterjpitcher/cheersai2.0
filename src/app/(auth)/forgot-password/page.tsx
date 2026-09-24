'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { AuthCard, AuthMessage } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestPasswordReset } from '@/lib/auth/actions';

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(
    async (_prev: { success?: boolean; error?: string } | null, formData: FormData) =>
      requestPasswordReset(formData),
    null,
  );

  return (
    <AuthCard title="Reset your password" description="We'll email you a link to choose a new password.">
      {state?.success ? (
        <AuthMessage tone="success">
          If that email has a Cheers account, a reset link is on its way. Check your inbox and spam folder.
        </AuthMessage>
      ) : (
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" placeholder="you@yourvenue.com" required autoComplete="email" autoFocus />
          </div>
          <Button type="submit" variant="primary" size="lg" full disabled={pending}>
            {pending ? 'Sending...' : 'Send reset link'}
          </Button>
          {state?.error && <AuthMessage tone="error">{state.error}</AuthMessage>}
        </form>
      )}
      <p className="text-center text-sm">
        <Link href="/login" className="hover:underline" style={{ color: 'var(--c-ink-3)' }}>
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
