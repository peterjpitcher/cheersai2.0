import Link from 'next/link';
import { redirect } from 'next/navigation';

import { env } from '@/env';
import { signOut } from '@/lib/auth/actions';
import { SIGNUP_VENUE_PATH } from '@/lib/auth/email-links';
import { getCurrentUser } from '@/lib/auth/server';
import { VENUE_MESSAGES } from '@/lib/signup/messages';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';
import { decideVenueAccess, readVenueSignupState, type VenueAccess } from '@/lib/signup/venue';
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
 * It is offered only to someone /signup/venue would let in (decideVenueAccess):
 * a person with an open invitation is pointed at accepting it; a member of
 * only closed brands, or someone removed from the venue they set up, gets a
 * notice (the trial page would send them back here); admins get neither. A
 * failed lookup offers nothing. With the switch off or unreadable the page is
 * exactly as before.
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

  let access: VenueAccess | null = null;
  if (env.server.VERCEL_ENV !== 'preview' && (await getSelfServeSignupSwitch()) === 'open') {
    try {
      access = decideVenueAccess(await readVenueSignupState(createServiceSupabaseClient(), user.id));
    } catch (error) {
      console.error('[no-access] venue sign-up lookup failed; not offering a trial', error);
    }
  }
  const canStartVenue = access === 'form' && invitationCount === 0;
  const showInvitations = invitationCount > 0 || access === 'invited';
  const notice =
    access === 'member_no_brand'
      ? VENUE_MESSAGES.memberNoBrand
      : access === 'removed'
        ? VENUE_MESSAGES.removed
        : access === 'venue_closed'
          ? VENUE_MESSAGES.venueClosed
          : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-[var(--c-fg)]">No brands assigned yet</h1>
        <p className="text-sm text-[var(--c-fg-muted)]">
          Your account isn&apos;t connected to any brand. Ask your administrator to give you
          access, then reload this page.
        </p>
      </div>
      {showInvitations ? (
        <Link
          href={INVITATIONS_PATH}
          className="rounded-full px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--c-orange)' }}
        >
          {invitationCount > 1 ? `You have ${invitationCount} invitations waiting` : 'You have an invitation waiting'}
        </Link>
      ) : null}
      {access === 'invited' ? (
        <p className="text-sm text-[var(--c-fg-muted)]">Accept it to join that venue on Cheers.</p>
      ) : null}
      {notice ? <p className="text-sm text-[var(--c-fg-muted)]">{notice}</p> : null}
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
