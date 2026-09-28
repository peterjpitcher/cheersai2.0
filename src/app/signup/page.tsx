import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { env } from '@/env';
import { CONTACT } from '@/lib/legal/company';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { SignupForm } from './signup-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign up',
  robots: { index: false, follow: false },
};

async function isSignedIn(): Promise<boolean> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    return false;
  }
}

function TalkToUs() {
  const linkStyle = { color: 'var(--c-orange)' };
  return (
    <div className="space-y-3 text-center text-sm" style={{ color: 'var(--c-ink-2)' }}>
      <p>
        Email{' '}
        <a href={`mailto:${CONTACT.email}`} className="font-semibold hover:underline" style={linkStyle}>
          {CONTACT.email}
        </a>{' '}
        or WhatsApp{' '}
        <a
          href={`https://wa.me/${CONTACT.whatsappE164.replace('+', '')}`}
          className="font-semibold hover:underline"
          style={linkStyle}
        >
          {CONTACT.whatsappDisplay}
        </a>
        .
      </p>
      <p>
        <Link href="/login" className="hover:underline" style={{ color: 'var(--c-ink-3)' }}>
          Already have a login? Sign in
        </Link>
      </p>
    </div>
  );
}

/**
 * The self-serve sign-up request (tasks/SPEC-self-serve-signup.md §4.2):
 * email and a Cloudflare Turnstile check only.
 *
 * While the sign-up switch (app_flags.self_serve_signup) is off or cannot be
 * read, the page says "Talk to us" and shows no form. On a Vercel Preview the
 * form is shown so it can be reviewed, but requestSignup refuses every
 * request there, because Preview writes to the live database.
 */
export default async function SignupPage() {
  // Signed in already: nothing to sign up for (redirect() throws, so it stays out of the try).
  if (await isSignedIn()) redirect('/planner');

  const preview = env.server.VERCEL_ENV === 'preview';
  const state = await getSelfServeSignupSwitch();
  if (!preview && state !== 'open') {
    return (
      <AuthCard title="Sign-up is not open yet" description="We are not taking sign-ups on the website yet. Talk to us and we will help you get started.">
        <TalkToUs />
      </AuthCard>
    );
  }

  const siteKey = env.client.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) {
    // Production builds refuse to start without it (src/env.ts); this covers a misconfigured server.
    return (
      <AuthCard title="Sign-up is not available right now" description="Please try again later, or talk to us.">
        <TalkToUs />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Start your free trial"
      description="Enter your email and we will send you a link to confirm it. Then you set up your venue and your password."
    >
      <SignupForm siteKey={siteKey} preview={preview} />
    </AuthCard>
  );
}
