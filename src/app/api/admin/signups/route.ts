import { getCurrentUser } from '@/lib/auth/server';
import { createLogger } from '@/lib/logging';
import { loadSignupsOverview } from '@/lib/signup/admin-overview';

// ---------------------------------------------------------------------------
// GET /api/admin/signups: the admin Sign-ups card's data
// (tasks/SPEC-self-serve-signup.md §4.9, §4.10, P10), for super admins only.
//
// The card fetches this after the admin page has loaded, rather than the page
// reading it on the server, so the refresh after every admin action (Create
// brand, a billing override and the rest call revalidatePath('/admin') and
// router.refresh()) never waits for the sign-up reads.
//
// The flag is checked here, on the server, before anything is read: signed
// out gets 401, anyone else 403, and neither gets a byte of sign-up data.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

const logger = createLogger('signup');

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function GET(): Promise<Response> {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch (error) {
    logger.error('admin sign-ups card: sign-in check failed', error instanceof Error ? error : new Error(String(error)));
    return json({ error: 'We could not check your sign-in just now.' }, 503);
  }
  if (!user) return json({ error: 'Your session has ended. Sign in again.' }, 401);
  if (!user.isSuperAdmin) return json({ error: 'Only administrators can see the sign-up figures.' }, 403);

  const overview = await loadSignupsOverview();
  return json(overview, overview.status === 'ready' ? 200 : 503);
}
