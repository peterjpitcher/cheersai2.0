'use client';

import { useActionState } from 'react';

import { AuthMessage } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setPassword } from '@/lib/auth/actions';

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(
    async (_prev: { success?: boolean; error?: string; next?: string } | null, formData: FormData) => {
      const result = await setPassword(formData);
      if (result.success) {
        // Same-origin paths only (the server picks planner or Billing).
        const next = result.next && result.next.startsWith('/') && !result.next.startsWith('//') ? result.next : '/planner';
        window.location.href = next;
      }
      return result;
    },
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" autoFocus />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" />
      </div>
      <Button type="submit" variant="primary" size="lg" full disabled={pending || state?.success === true}>
        {pending ? 'Saving...' : 'Save password'}
      </Button>
      {state?.error && <AuthMessage tone="error">{state.error}</AuthMessage>}
    </form>
  );
}
