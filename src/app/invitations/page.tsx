import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AUTH_QUIET_LINK, AuthCard, AuthMessage } from '@/components/auth/auth-card';
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
    <AuthCard
      wide
      title="Invitations"
      description={`Signed in as ${user.email}. You only get access to a brand if you accept its invitation.`}
    >
      {invitations ? (
        <PendingInvitations invitations={invitations} />
      ) : (
        <AuthMessage tone="error">
          We could not load your invitations. Please reload the page, or email {CONTACT.email} if it keeps happening.
        </AuthMessage>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-6 text-sm">
        {user.activeAccountId ? (
          <Link href="/dashboard" className="font-medium text-ink underline underline-offset-4">
            Back to Cheers
          </Link>
        ) : null}
        <form action={signOut}>
          <button type="submit" className={AUTH_QUIET_LINK}>
            Sign out
          </button>
        </form>
      </div>
    </AuthCard>
  );
}
