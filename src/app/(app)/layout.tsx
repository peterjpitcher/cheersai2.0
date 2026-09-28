import { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { AuthProvider } from '@/components/providers/auth-provider';
import { isBillingEnforcementEnabled } from "@/lib/billing/enforcement";
import { can } from "@/lib/billing/entitlement";
import { ENTITLEMENT_MESSAGES, getBrandEntitlement } from "@/lib/billing/entitlement-server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { ConnectionHealthToast } from '@/features/connections/connection-toast';
import { signOut } from '@/lib/auth/actions';
import { getCurrentUser } from '@/lib/auth/server';
import { getConnectionHealthSummaries } from '@/lib/connections/health';
import { getUnreadNotificationCount } from '@/lib/planner/notifications';
import { INVITATIONS_PATH, listPendingInvitationsForUser, type PendingInvitation } from '@/lib/team/invitations';
import type { ConnectionHealthSummary } from '@/types/providers';

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * Protected layout for all (app)/* routes.
 * Gets the current user and redirects to login if unauthenticated.
 * Passes user to AuthProvider for client-side access.
 * Fetches connection health for sidebar dots and login toast (D-01, D-03).
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  // Authenticated but with no accessible brand -> dedicated empty state, not
  // the brand-scoped shell (whose queries all assume an active brand).
  if (!user.activeAccountId) {
    redirect('/no-access');
  }

  // Fetch connection health for sidebar dots and toast — silent fallback on error
  let healthSummaries: ConnectionHealthSummary[] = [];
  try {
    healthSummaries = await getConnectionHealthSummaries();
  } catch {
    // Silent fallback — no health dots or toast if query fails
  }

  // Billing hold banner (only when enforcement is on). A lookup failure shows no
  // banner; every guarded action still re-checks and fails closed on its own.
  let heldMessage: string | null = null;
  try {
    const service = createServiceSupabaseClient();
    if (await isBillingEnforcementEnabled(service)) {
      const state = await getBrandEntitlement(service, user.activeAccountId);
      if (!can(state, "create")) heldMessage = ENTITLEMENT_MESSAGES[state] ?? null;
    }
  } catch (error) {
    console.error("[layout] entitlement lookup failed", error);
  }

  // Fetch unread notification count for sidebar badge — silent fallback to 0
  let notificationCount = 0;
  try {
    notificationCount = await getUnreadNotificationCount();
  } catch {
    // Silent fallback — badge shows 0 if query fails
  }

  // Team invitations waiting for this person (spec §4.6). A convenience
  // banner only: /invitations shows its own error if the lookup fails.
  let pendingInvitations: PendingInvitation[] = [];
  try {
    pendingInvitations = await listPendingInvitationsForUser(createServiceSupabaseClient(), user.id);
  } catch (error) {
    console.error("[layout] team invitations lookup failed", error);
  }

  return (
    <AuthProvider value={user}>
      <AppShell
        healthSummaries={healthSummaries}
        notificationCount={notificationCount}
        signOutAction={signOut}
      >
        {heldMessage ? (
          <div
            role="status"
            className="mb-4 rounded-[var(--r-md)] p-3 text-sm font-medium"
            style={{ backgroundColor: "var(--c-claret-soft)", color: "var(--c-claret)" }}
          >
            {heldMessage}
          </div>
        ) : null}
        {pendingInvitations.length > 0 ? (
          <div
            role="status"
            className="mb-4 rounded-[var(--r-md)] p-3 text-sm"
            style={{ backgroundColor: "var(--c-orange-soft)", color: "var(--c-ink)" }}
          >
            {pendingInvitations.length === 1
              ? `You have been invited to join ${pendingInvitations[0].brandName}. `
              : `You have been invited to join ${pendingInvitations.length} brands. `}
            <Link href={INVITATIONS_PATH} className="font-medium underline">
              {pendingInvitations.length === 1 ? "View the invitation" : "View the invitations"}
            </Link>
          </div>
        ) : null}
        {children}
      </AppShell>
      <ConnectionHealthToast summaries={healthSummaries} />
    </AuthProvider>
  );
}
