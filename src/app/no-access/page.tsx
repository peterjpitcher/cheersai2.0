import { redirect } from 'next/navigation';

import { signOut } from '@/lib/auth/actions';
import { getCurrentUser } from '@/lib/auth/server';

/**
 * Shown to an authenticated user who has not been assigned any brand.
 * Deliberately OUTSIDE the (app) route group so it does not require an active
 * brand (which the (app) layout enforces). Not signed in -> login; has a brand
 * -> back into the app.
 */
export default async function NoAccessPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  if (user.activeAccountId) {
    redirect('/');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-[var(--c-fg)]">No brands assigned yet</h1>
        <p className="text-sm text-[var(--c-fg-muted)]">
          Your account isn&apos;t connected to any brand. Ask your administrator to give you
          access, then reload this page.
        </p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-full border border-[var(--c-line)] px-4 py-2 text-sm text-[var(--c-fg)] transition-colors hover:bg-[var(--c-surface-2)]"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
