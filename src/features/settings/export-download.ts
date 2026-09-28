import { OWNER_DATA_MESSAGES, OWNER_EXPORT_HEADER, OWNER_EXPORT_PATH } from '@/lib/settings/owner-data';

/**
 * The browser side of "Download my data": ask the export route for the file
 * and turn its answer into either the file or the message to show. Kept out
 * of the component so the answers can be tested without a browser.
 */

export type ExportDownload = { ok: true; blob: Blob; fileName: string } | { ok: false; error: string };

const FALLBACK_FILE_NAME = 'cheers-export.json';

/** The file name from `Content-Disposition: attachment; filename="..."`, or null when it is not a download. */
export function attachmentFileName(header: string | null): string | null {
  if (!header || !/^\s*attachment\b/i.test(header)) return null;
  const match = /filename="([^"]+)"/i.exec(header);
  return match?.[1] ?? FALLBACK_FILE_NAME;
}

export async function readExportResponse(response: Response): Promise<ExportDownload> {
  // Signed out: requireAuthContext redirects to the sign-in page, which the
  // request does not follow.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    return { ok: false, error: OWNER_DATA_MESSAGES.signedOut };
  }
  const fileName = response.ok ? attachmentFileName(response.headers.get('content-disposition')) : null;
  if (fileName) {
    try {
      return { ok: true, blob: await response.blob(), fileName };
    } catch {
      return { ok: false, error: OWNER_DATA_MESSAGES.exportFailed };
    }
  }
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error) return { ok: false, error: body.error };
  } catch {
    // Not our JSON (a platform error page, for example): fall through.
  }
  return { ok: false, error: OWNER_DATA_MESSAGES.exportFailed };
}

export async function requestOwnerExport(accountId: string, fetchImpl: typeof fetch = fetch): Promise<ExportDownload> {
  let response: Response;
  try {
    response = await fetchImpl(OWNER_EXPORT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [OWNER_EXPORT_HEADER]: '1' },
      body: JSON.stringify({ accountId }),
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, error: OWNER_DATA_MESSAGES.exportFailed };
  }
  return readExportResponse(response);
}
