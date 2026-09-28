import { logAdminEvent } from '@/lib/admin/audit';
import { brandExportFile, exportBrandData } from '@/lib/admin/offboarding';
import { consumeAuthRateLimit } from '@/lib/auth/rate-limit';
import { isOwner } from '@/lib/auth/roles';
import { requireAuthContext } from '@/lib/auth/server';
import { createLogger } from '@/lib/logging';
import { OWNER_DATA_MESSAGES, OWNER_EXPORT_HEADER } from '@/lib/settings/owner-data';
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
//   2. a signed-in login with an active brand (requireAuthContext);
//   3. the brand the page was rendered for is still the active brand;
//   4. an owner of that brand;
//   5. the self-serve sign-up switch is on (unreadable counts as off);
//   6. 3 exports a day per brand (database limiter; a limiter error refuses);
//   7. build the export, record it in admin_audit (kind only), then send it.
//
// A dependency failure shows the owner an error with our email address and
// alerts the operator (reportSignupFailure). Nothing is sent unless every step
// succeeded, so a failure never looks like a finished download.
//
// Size: the whole export is built first (so a failure is a clean error, not a
// half file), then streamed in chunks. A streamed response is not subject to
// Vercel's 4.5 MB limit on function responses, which a large brand passes:
// measured on the local stack (28 September 2026), 5,000 posts with a
// 350-character caption and 3,000 media items came to 4.05 MB before media
// links, and each signed media link adds about 0.4 KB (about 5.3 MB in all).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** That export took about 0.2 seconds to build on the local stack; this leaves ample room for a slower network. */
export const maxDuration = 60;

const logger = createLogger('owner-export');

const CHUNK_BYTES = 64 * 1024;

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** The export as a download, sent a chunk at a time. */
function streamFile(json: string, fileName: string): Response {
  const bytes = new TextEncoder().encode(json);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function pageAccountId(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { accountId?: unknown } | null;
    return typeof body?.accountId === 'string' ? body.accountId : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get(OWNER_EXPORT_HEADER) !== '1') return refuse(403, OWNER_DATA_MESSAGES.exportFailed);

  const ctx = await requireAuthContext();
  const accountId = ctx.accountId;
  if ((await pageAccountId(request)) !== accountId) return refuse(409, OWNER_DATA_MESSAGES.brandSwitched);
  if (!isOwner(ctx)) return refuse(403, OWNER_DATA_MESSAGES.ownersOnly);

  const signupSwitch = await getSelfServeSignupSwitch();
  if (signupSwitch === 'unavailable') {
    await reportSignupFailure('switch', new Error(`the switch could not be read for an owner export (brand ${accountId})`));
    return refuse(503, OWNER_DATA_MESSAGES.exportFailed);
  }
  if (signupSwitch !== 'open') return refuse(404, OWNER_DATA_MESSAGES.notAvailable);

  try {
    const limit = await consumeAuthRateLimit('owner_data_export', { email: '', ip: '', accountId });
    if (limit.status === 'limited') return refuse(429, OWNER_DATA_MESSAGES.exportLimited(limit.retryAfterSeconds));
  } catch (error) {
    await reportSignupFailure('owner_export', new Error(`limiter: ${error instanceof Error ? error.message : String(error)} (brand ${accountId})`));
    return refuse(503, OWNER_DATA_MESSAGES.exportFailed);
  }

  let file: { json: string; fileName: string };
  try {
    const started = Date.now();
    file = brandExportFile(accountId, await exportBrandData(ctx.supabase, accountId));
    logger.info('owner export built', { accountId, bytes: file.json.length, ms: Date.now() - started });
  } catch (error) {
    await reportSignupFailure('owner_export', new Error(`export: ${error instanceof Error ? error.message : String(error)} (brand ${accountId})`));
    return refuse(500, OWNER_DATA_MESSAGES.exportFailed);
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
    await reportSignupFailure('owner_export', new Error(`admin_audit: ${error instanceof Error ? error.message : String(error)} (brand ${accountId})`));
    return refuse(500, OWNER_DATA_MESSAGES.exportFailed);
  }

  return streamFile(file.json, file.fileName);
}
