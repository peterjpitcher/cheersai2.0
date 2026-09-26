import { redirect } from 'next/navigation';

import { AdminClient } from '@/app/(app)/admin/admin-client';
import { env } from '@/env';
import { getAdminOverview } from '@/lib/admin/data';
import { requireAuthContext } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

/**
 * Super-admin admin surface. Manage brands and grant/revoke user access +
 * admin status.
 *
 * admin/layout.tsx also gates this route, but a layout renders in parallel
 * with its page, so it cannot stop the page's service-role read of every
 * brand and user. The gate is repeated here, before the read.
 */
export default async function AdminPage() {
  const { isSuperAdmin } = await requireAuthContext();
  if (!isSuperAdmin) {
    redirect('/planner');
  }

  const { brands, users } = await getAdminOverview();
  const siteUrl = env.client.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? '';
  const ingestEndpoint = `${siteUrl}/api/booking-conversions`;

  return (
    <main className="mx-auto max-w-5xl p-5">
      <header className="mb-5">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--c-ink)' }}>Administration</h1>
        <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>
          Create brands and manage who can access them.
        </p>
      </header>
      <AdminClient brands={brands} users={users} ingestEndpoint={ingestEndpoint} />
    </main>
  );
}
