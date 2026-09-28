import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { parseConfirmLinkParams, type ConfirmLinkType } from '@/lib/auth/confirm-link';

import { confirmEmailLink } from './actions';
import { ConfirmButton } from './confirm-button';

export const metadata: Metadata = {
  title: 'Confirm and continue',
  robots: { index: false, follow: false },
  // The one-time token is in this page's address, so never send it to another
  // site. Not 'no-referrer': with that, a browser posting the form before
  // JavaScript loads sends `Origin: null`, and Next.js refuses the server action.
  referrer: 'same-origin',
};

const COPY: Record<ConfirmLinkType, { title: string; description: string }> = {
  invite: {
    title: 'Accept your invite',
    description: 'Press the button to accept your invite to Cheers. You will then choose your password.',
  },
  recovery: {
    title: 'Reset your password',
    description: 'Press the button to continue. You will then choose a new password.',
  },
};

interface ConfirmPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Landing page for the links in our invite and password reset emails
 * (buildAuthConfirmUrl). Opening it uses nothing: it only shows a button.
 * The button POSTs to confirmEmailLink, which verifies the one-time token and
 * signs the person in. Email security scanners that fetch links therefore
 * cannot use the link up (spec §4.3). Links sent before this change have the
 * same address and keep working.
 */
export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const params = parseConfirmLinkParams(await searchParams);
  if (!params) redirect('/login?error=invalid_confirmation');

  const copy = COPY[params.type];
  return (
    <AuthCard title={copy.title} description={copy.description}>
      <form action={confirmEmailLink} className="space-y-4">
        <input type="hidden" name="token_hash" value={params.tokenHash} />
        <input type="hidden" name="type" value={params.type} />
        <input type="hidden" name="next" value={params.next} />
        <ConfirmButton />
      </form>
      <p className="text-center text-sm" style={{ color: 'var(--c-ink-3)' }}>
        We ask you to press the button because some email security tools open links on their own, which would use up
        this one-time link before you could.
      </p>
    </AuthCard>
  );
}
