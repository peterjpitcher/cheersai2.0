import { logAdminEvent } from '@/lib/admin/audit';
import { brandExportFile, exportBrandData } from '@/lib/admin/offboarding';
import { consumeAuthRateLimit, peekAuthRateLimit } from '@/lib/auth/rate-limit';
import { EXPORT_REQUEST_HEADER } from '@/lib/export/download-request';
import { exportRefusal as refuse, requestedAccountId, streamJsonDownload } from '@/lib/export/stream-response';
import { createLogger } from '@/lib/logging';
import { isBrandOwnerMember, ownerActionContext } from '@/lib/settings/owner-access';
import { OWNER_DATA_MESSAGES } from '@/lib/settings/owner-data';
import { reportSignupFailure } from '@/lib/signup/alerts';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

// ---------------------------------------------------------------------------
// POST /api/settings/data-export: an owner's "Download my data" in Settings
// (tasks/SPEC-self-serve-signup.md, section 5, "Later (P10)").
//
// The file is the operator's export (exportBrandData and brandExportFile in
// src/lib/admin/offboarding.ts), so the owner and the operator get the same
// content in the same layout. Each step fails closed:
//
//   1. only from the Settings page (a custom header no other site can send);
//   2. a signed-in login with an active brand (requireAuthContext; a failed
//      membership lookup is an error with our address and an alert);
//   3. the brand the page was rendered for is still the active brand;
//   4. a real owner of that brand: an account_members row with role owner (a
//      super-admin's implied owner role does not count; operators use Admin);
//   5. the self-serve sign-up switch is on (unreadable counts as off);
//   6. fewer than 3 exports for the brand in the current 24-hour window
//      (peekAuthRateLimit: a read, nothing counted yet);
//   7. build the export and record it in admin_audit (kind only);
//   8. count it (consumeAuthRateLimit, atomic). A burst that passed step 6
//      together is cut off here, so no more than 3 files leave per window;
//      a refused one leaves only its admin_audit row. Failures before this
//      point never use up the owner's quota;
//   9. send it.
//
// A dependency failure shows the owner an error with our email address and
// alerts the operator (reportSignupFailure). Nothing is sent unless every step
// succeeded, so a failure never looks like a finished download.
//
// Size: the whole export is built first (so a failure is a clean error, not a
// half file), then streamed in chunks (src/lib/export/stream-response.ts), so
// Vercel's 4.5 MB limit on function responses does not apply. Measured on the
// local stack (28 September 2026): 5,000 posts with a 350-character caption
// and 3,000 media items came to 4.05 MB before media links, and each signed
// media link adds about 0.4 KB (about 5.3 MB in all).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** That export took about 0.2 seconds to build on the local stack; this leaves ample room for a slower network. */
export const maxDuration = 60;

const logger = createLogger('owner-export');

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function failed(status: number, what: string, error: unknown, accountId: string | null): Promise<Response> {
  await reportSignupFailure('owner_export', new Error(`${what}: ${messageOf(error)}${accountId ? ` (brand ${accountId})` : ''}`));
  return refuse(status, OWNER_DATA_MESSAGES.exportFailed);
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get(EXPORT_REQUEST_HEADER) !== '1') return refuse(403, OWNER_DATA_MESSAGES.exportFailed);

  const ctx = await ownerActionContext();
  if ('unavailable' in ctx) return failed(503, 'sign-in lookup', ctx.unavailable, null);
  const accountId = ctx.accountId;
  if ((await requestedAccountId(request)) !== accountId) return refuse(409, OWNER_DATA_MESSAGES.brandSwitched);

  try {
    if (!(await isBrandOwnerMember(ctx.supabase, accountId, ctx.user.id))) return refuse(403, OWNER_DATA_MESSAGES.ownersOnly);
  } catch (error) {
    return failed(503, 'owner lookup', error, accountId);
  }

  const signupSwitch = await getSelfServeSignupSwitch();
  if (signupSwitch === 'unavailable') {
    await reportSignupFailure('switch', new Error(`the switch could not be read for an owner export (brand ${accountId})`));
    return refuse(503, OWNER_DATA_MESSAGES.exportFailed);
  }
  if (signupSwitch !== 'open') return refuse(404, OWNER_DATA_MESSAGES.notAvailable);

  const subject = { email: '', ip: '', accountId };
  try {
    const limit = await peekAuthRateLimit('owner_data_export', subject);
    if (limit.status === 'limited') return refuse(429, OWNER_DATA_MESSAGES.exportLimited(limit.retryAfterSeconds));
  } catch (error) {
    return failed(503, 'limiter', error, accountId);
  }

  let file: { json: string; fileName: string };
  try {
    const started = Date.now();
    file = brandExportFile(accountId, await exportBrandData(ctx.supabase, accountId));
    logger.info('owner export built', { accountId, bytes: file.json.length, ms: Date.now() - started });
  } catch (error) {
    return failed(500, 'export', error, accountId);
  }

  // Every export is on record before anything leaves (kind only: no names,
  // emails or content). If it cannot be recorded, nothing is sent.
  try {
    await logAdminEvent({
      actorUserId: ctx.user.id,
      action: 'export_brand_data',
      targetAccountId: accountId,
      detail: { kind: 'owner_download' },
    });
  } catch (error) {
    return failed(500, 'admin_audit', error, accountId);
  }

  try {
    const counted = await consumeAuthRateLimit('owner_data_export', subject);
    if (counted.status === 'limited') return refuse(429, OWNER_DATA_MESSAGES.exportLimited(counted.retryAfterSeconds));
  } catch (error) {
    return failed(503, 'limiter', error, accountId);
  }

  return streamJsonDownload(file.json, file.fileName);
}
