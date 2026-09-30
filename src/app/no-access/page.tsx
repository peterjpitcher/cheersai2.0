import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { Button, buttonVariants } from '@/components/ui/button';
import { env } from '@/env';
import { signOut } from '@/lib/auth/actions';
import { SIGNUP_VENUE_PATH } from '@/lib/auth/email-links';
import { getCurrentUser } from '@/lib/auth/server';
import { VENUE_MESSAGES } from '@/lib/signup/messages';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';
import { decideVenueAccess, readVenueSignupState, type VenueAccess } from '@/lib/signup/venue';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { INVITATIONS_PATH, listPendingInvitationsForUser } from '@/lib/team/invitations';
import { cn } from '@/lib/utils';

/** The page's main action, in the homepage's call-to-action colours. */
const PRIMARY_LINK = cn(buttonVariants({ variant: 'cta', size: 'xl' }), 'w-full');

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
    <AuthCard
      title="No brands assigned yet"
      description="Your account isn't connected to any brand. Ask your administrator to give you access, then reload this page."
    >
      {showInvitations ? (
        <div className="space-y-3">
          <Link href={INVITATIONS_PATH} className={PRIMARY_LINK}>
            {invitationCount > 1 ? `You have ${invitationCount} invitations waiting` : 'You have an invitation waiting'}
          </Link>
          {access === 'invited' ? (
            <p className="text-center text-sm text-ink-2">Accept it to join that venue on Cheers.</p>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p className="rounded-[var(--r-lg)] border border-orange-soft bg-orange-tint p-3 text-sm leading-relaxed text-ink-2">
          {notice}
        </p>
      ) : null}
      {canStartVenue ? (
        <Link href={SIGNUP_VENUE_PATH} className={PRIMARY_LINK}>
          Start a free trial for your venue
        </Link>
      ) : null}
      <form action={signOut}>
        <Button type="submit" variant="secondary" size="xl" full>
          Sign out
        </Button>
      </form>
    </AuthCard>
  );
}
