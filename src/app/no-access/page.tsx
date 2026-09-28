import Link from 'next/link';
import { redirect } from 'next/navigation';

import { env } from '@/env';
import { signOut } from '@/lib/auth/actions';
import { SIGNUP_VENUE_PATH } from '@/lib/auth/email-links';
import { getCurrentUser } from '@/lib/auth/server';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { INVITATIONS_PATH, listPendingInvitationsForUser } from '@/lib/team/invitations';

/**
 * Shown to an authenticated user who has not been assigned any brand.
 * Deliberately OUTSIDE the (app) route group so it does not require an active
 * brand (which the (app) layout enforces). Not signed in -> login; has a brand
 * -> back into the app.
 *
 * While the self-serve sign-up switch is on (never on a Vercel Preview), it
 * also offers "Start a free trial for your venue" (tasks/SPEC-self-serve-
 * signup.md §4.4), a plain link to /signup/venue, which checks everything
 * again. The link writes nothing: the sign-up record is made with the venue.
 * With the switch off or unreadable the page is exactly as before.
 */
export default async function NoAccessPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  if (user.activeAccountId) {
    redirect('/');
  }

  // Someone invited to a brand who has not accepted yet has no brand, so show
  // the way to their invitations here. A lookup failure just hides the link.
  let invitationCount = 0;
  try {
    invitationCount = (await listPendingInvitationsForUser(createServiceSupabaseClient(), user.id)).length;
  } catch (error) {
    console.error('[no-access] team invitations lookup failed', error);
  }

  let canStartVenue = false;
  if (env.server.VERCEL_ENV !== 'preview') {
    canStartVenue = (await getSelfServeSignupSwitch()) === 'open';
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
      {invitationCount > 0 ? (
        <Link
          href={INVITATIONS_PATH}
          className="rounded-full px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--c-orange)' }}
        >
          {invitationCount === 1 ? 'You have an invitation waiting' : `You have ${invitationCount} invitations waiting`}
        </Link>
      ) : null}
      {canStartVenue ? (
        <Link
          href={SIGNUP_VENUE_PATH}
          className="rounded-full px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--c-orange)' }}
        >
          Start a free trial for your venue
        </Link>
      ) : null}
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
