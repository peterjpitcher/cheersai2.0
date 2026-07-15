import { AdminClient } from '@/app/(app)/admin/admin-client';
import { env } from '@/env';
import { getAdminOverview } from '@/lib/admin/data';

export const dynamic = 'force-dynamic';

/**
 * Super-admin admin surface. Access is gated by admin/layout.tsx.
 * Manage brands and grant/revoke user access + admin status.
 */
export default async function AdminPage() {
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
