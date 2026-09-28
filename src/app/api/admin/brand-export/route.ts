import { z } from 'zod';

import { logAdminEvent } from '@/lib/admin/audit';
import { brandExportFile, exportBrandData } from '@/lib/admin/offboarding';
import { AuthDependencyError } from '@/lib/auth/errors';
import { requireAuthContext } from '@/lib/auth/server';
import type { AuthContext } from '@/lib/auth/types';
import { EXPORT_REQUEST_HEADER } from '@/lib/export/download-request';
import { exportRefusal, requestedAccountId, streamJsonDownload } from '@/lib/export/stream-response';
import { createLogger } from '@/lib/logging';
import { reportSignupFailure } from '@/lib/signup/alerts';

// ---------------------------------------------------------------------------
// POST /api/admin/brand-export: Admin, Offboarding, "Export data" (spec §4.7,
// D5; docs/runbooks/customer-offboarding.md step 4).
//
// It replaces the exportBrandDataAction server action, which returned the
// whole file in one response and could pass Vercel's 4.5 MB limit for a large
// brand. The operator's checks and record are unchanged:
//   - super-admin only (requireAuthContext, then isSuperAdmin), else "Forbidden.";
//   - the brand id must be a UUID, else "Invalid brand.";
//   - build the export, record export_brand_data in admin_audit (actor and
//     brand, no detail), and only then send it; any failure is logged and
//     answered "The export failed. Try again.", with nothing sent.
// New for a route: the Settings-style request header, standing in for the
// Origin check a server action gets, so another site cannot start an export;
// and a failed sign-in lookup (AuthDependencyError) is answered with the same
// "The export failed. Try again." and alerted (admin_export, the error message
// only), instead of Next's bare 500. A signed-out visitor is still redirected.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const logger = createLogger('admin');

const uuid = z.string().uuid();

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get(EXPORT_REQUEST_HEADER) !== '1') return exportRefusal(403, 'Forbidden.');

  let ctx: AuthContext;
  try {
    ctx = await requireAuthContext();
  } catch (error) {
    if (!(error instanceof AuthDependencyError)) throw error;
    logger.error('export brand data failed: sign-in lookup', error);
    await reportSignupFailure('admin_export', new Error(`sign-in lookup: ${error.message}`));
    return exportRefusal(503, 'The export failed. Try again.');
  }
  if (!ctx.isSuperAdmin) return exportRefusal(403, 'Forbidden.');

  const accountId = await requestedAccountId(request);
  if (!accountId || !uuid.safeParse(accountId).success) return exportRefusal(400, 'Invalid brand.');

  let file: { json: string; fileName: string };
  try {
    const data = await exportBrandData(ctx.supabase, accountId);
    await logAdminEvent({ actorUserId: ctx.user.id, action: 'export_brand_data', targetAccountId: accountId });
    file = brandExportFile(accountId, data);
  } catch (error) {
    logger.error('export brand data failed', error instanceof Error ? error : undefined, { accountId });
    return exportRefusal(500, 'The export failed. Try again.');
  }

  return streamJsonDownload(file.json, file.fileName);
}
