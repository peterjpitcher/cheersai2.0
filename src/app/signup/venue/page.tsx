import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AUTH_LINK, AUTH_QUIET_LINK, AuthCard } from '@/components/auth/auth-card';
import { buttonVariants } from '@/components/ui/button';
import { env } from '@/env';
import { signOut } from '@/lib/auth/actions';
import { CONTACT } from '@/lib/legal/company';
import { reportSignupFailure } from '@/lib/signup/alerts';
import { VENUE_MESSAGES } from '@/lib/signup/messages';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';
import {
  decideVenueAccess,
  destinationForMember,
  markSignupVerified,
  readSignedInLogin,
  readVenueSignupState,
  type VenueSignupState,
} from '@/lib/signup/venue';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { INVITATIONS_PATH } from '@/lib/team/invitations';
import { cn } from '@/lib/utils';

import { VenueForm } from './venue-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set up your venue',
  robots: { index: false, follow: false },
};

function ContactLine(): React.JSX.Element {
  return (
    <p className="text-center text-sm text-ink-2">
      Questions? Email{' '}
      <a href={`mailto:${CONTACT.email}`} className={AUTH_LINK}>
        {CONTACT.email}
      </a>{' '}
      or WhatsApp{' '}
      <a href={`https://wa.me/${CONTACT.whatsappE164.replace('+', '')}`} className={AUTH_LINK}>
        {CONTACT.whatsappDisplay}
      </a>
      .
    </p>
  );
}

function SignOutButton({ label }: { label: string }): React.JSX.Element {
  return (
    <form action={signOut} className="text-center">
      <button type="submit" className={`text-sm ${AUTH_QUIET_LINK}`}>
        {label}
      </button>
    </form>
  );
}

function Notice({ title, description, signedIn = false }: { title: string; description: string; signedIn?: boolean }): React.JSX.Element {
  return (
    <AuthCard title={title} description={description}>
      <ContactLine />
      {signedIn ? <SignOutButton label="Sign out" /> : null}
    </AuthCard>
  );
}

/**
 * Venue set-up for a signed-in person with a confirmed email and no brand
 * (tasks/SPEC-self-serve-signup.md §4.4): the next step after a sign-up link,
 * or the /no-access entry for an existing login with no brand.
 *
 * This page and createSelfServeVenue are the gate for confirmed sign-up links
 * (§4.3): /auth/confirm signs whoever opens a valid link in, so nothing here
 * is shown or created unless the sign-up switch is on (and never on a Vercel
 * Preview). While the switch is off, a confirmed sign-up link only ever leads
 * to "Sign-up is not open yet".
 */
export default async function SignupVenuePage(): Promise<React.JSX.Element> {
  if (env.server.VERCEL_ENV === 'preview') {
    return <Notice title="Not available on previews" description={VENUE_MESSAGES.preview} />;
  }

  const state = await getSelfServeSignupSwitch();
  if (state === 'unavailable') {
    await reportSignupFailure('switch', new Error('app_flags.self_serve_signup could not be read (venue set-up page)'));
    return <Notice title="Something went wrong" description={VENUE_MESSAGES.couldNotFinish} />;
  }
  if (state !== 'open') {
    return (
      <Notice
        title="Sign-up is not open yet"
        description="We are not taking sign-ups on the website yet. Talk to us and we will help you get started."
      />
    );
  }

  const login = await readSignedInLogin();
  if (login.status === 'unavailable') {
    await reportSignupFailure('session', new Error(login.error));
    return <Notice title="Something went wrong" description={VENUE_MESSAGES.couldNotFinish} />;
  }
  if (login.status === 'signed_out') {
    return (
      <AuthCard title="Your link has expired" description={VENUE_MESSAGES.signedOut}>
        <div className="space-y-3 text-center text-sm">
          <Link href="/signup" className={cn(buttonVariants({ variant: 'cta', size: 'xl' }), 'w-full')}>
            Ask for a new link
          </Link>
          <p>
            <Link href="/login" className={AUTH_QUIET_LINK}>
              Already set a password? Sign in
            </Link>
          </p>
        </div>
        <ContactLine />
      </AuthCard>
    );
  }

  const { user } = login;
  if (!user.emailConfirmed || !user.email) {
    return <Notice title="Confirm your email first" description={VENUE_MESSAGES.unconfirmed} signedIn />;
  }

  let signupState: VenueSignupState;
  try {
    const service = createServiceSupabaseClient();
    signupState = await readVenueSignupState(service, user.id);
    // The funnel's "verified" step (spec §4.10), first visit only.
    if (signupState.signup && !signupState.signup.verifiedAt) await markSignupVerified(service, user.id);
  } catch (error) {
    await reportSignupFailure('venue_lookup', error);
    return <Notice title="Something went wrong" description={VENUE_MESSAGES.couldNotFinish} signedIn />;
  }

  const access = decideVenueAccess(signupState);
  // Already in a live brand: into the app (redirect() throws, so it stays out of the try).
  if (access === 'own_venue' || access === 'member') redirect(await destinationForMember(user, signupState.signup));
  if (access === 'member_no_brand') {
    return <Notice title="Your venue is closed" description={VENUE_MESSAGES.memberNoBrand} signedIn />;
  }
  if (access === 'removed') {
    return <Notice title="No access to this venue" description={VENUE_MESSAGES.removed} signedIn />;
  }
  if (access === 'venue_closed') {
    return <Notice title="This venue has been closed" description={VENUE_MESSAGES.venueClosed} signedIn />;
  }
  if (access === 'admin') {
    return (
      <AuthCard title="Not for admin logins" description={VENUE_MESSAGES.admin}>
        <Link href="/admin" className={cn(buttonVariants({ variant: 'cta', size: 'xl' }), 'w-full')}>
          Go to Admin
        </Link>
      </AuthCard>
    );
  }
  if (access === 'invited') {
    return (
      <AuthCard title="You have an invitation" description={VENUE_MESSAGES.invited}>
        <Link href={INVITATIONS_PATH} className={cn(buttonVariants({ variant: 'cta', size: 'xl' }), 'w-full')}>
          See your invitation
        </Link>
        <ContactLine />
        <SignOutButton label="Sign out" />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set up your venue" description="Tell us about you and your venue, and choose your password. Your free trial starts next.">
      <div className="space-y-1 rounded-[var(--r-lg)] border border-line bg-paper p-3 text-center text-sm text-ink-2">
        <p>
          Signed in as <strong>{user.email}</strong>.
        </p>
        <SignOutButton label="Not you? Sign out" />
      </div>
      <VenueForm />
      <ContactLine />
    </AuthCard>
  );
}
