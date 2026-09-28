import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PendingInvitations, type PendingInvitationView } from '@/features/team/pending-invitations';
import { signOut } from '@/lib/auth/actions';
import { getCurrentUser } from '@/lib/auth/server';
import { CONTACT } from '@/lib/legal/company';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { INVITATIONS_PATH, listPendingInvitationsForUser } from '@/lib/team/invitations';
import { formatUkLongDate } from '@/lib/utils/date';

export const metadata: Metadata = {
  title: 'Invitations',
  robots: { index: false, follow: false },
};

/**
 * Where someone who already has a Cheers login accepts or declines a team
 * invitation (spec §4.6). Deliberately OUTSIDE the (app) route group, like
 * /no-access, so a person with no brand yet can still reach it. Not signed in:
 * sign in first, then come back here.
 */
export default async function InvitationsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(INVITATIONS_PATH)}`);
  }

  let invitations: PendingInvitationView[] | null = null;
  try {
    const pending = await listPendingInvitationsForUser(createServiceSupabaseClient(), user.id);
    invitations = pending.map((invitation) => ({
      id: invitation.id,
      brandName: invitation.brandName,
      role: invitation.role,
      expiresOn: formatUkLongDate(invitation.expiresAt),
    }));
  } catch (error) {
    console.error('[invitations] could not load invitations', error);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--c-ink)' }}>
          Invitations
        </h1>
        <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          Signed in as {user.email}. You only get access to a brand if you accept its invitation.
        </p>
      </div>

      {invitations ? (
        <PendingInvitations invitations={invitations} />
      ) : (
        <p
          role="alert"
          className="rounded-[var(--r-md)] p-3 text-sm"
          style={{ backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' }}
        >
          We could not load your invitations. Please reload the page, or email {CONTACT.email} if it keeps happening.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {user.activeAccountId ? (
          <Link href="/dashboard" className="font-medium underline" style={{ color: 'var(--c-ink)' }}>
            Back to Cheers
          </Link>
        ) : null}
        <form action={signOut}>
          <button type="submit" className="underline" style={{ color: 'var(--c-ink-3)' }}>
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
