/**
 * The browser side of the brand export downloads: the owner's "Download my
 * data" in Settings (/api/settings/data-export) and the operator's "Export
 * data" in Admin (/api/admin/brand-export). Both routes stream the same file
 * (brandExportFile in src/lib/admin/offboarding.ts).
 *
 * Client-safe: no server imports. Kept out of the components so the answers
 * can be tested without a browser.
 */

/**
 * A header both download requests send. A page on another site cannot add it
 * without a CORS preflight, which these routes never answer, so a cross-site
 * form or script cannot start an export (the Origin check a server action
 * would have had).
 */
export const EXPORT_REQUEST_HEADER = 'x-cheers-export';

export type ExportDownload = { ok: true; blob: Blob; fileName: string } | { ok: false; error: string };

/** What to show when the route gives no message of its own. */
export interface ExportDownloadMessages {
  failed: string;
  signedOut: string;
}

const FALLBACK_FILE_NAME = 'cheers-export.json';

/** The file name from `Content-Disposition: attachment; filename="..."`, or null when it is not a download. */
export function attachmentFileName(header: string | null): string | null {
  if (!header || !/^\s*attachment\b/i.test(header)) return null;
  const match = /filename="([^"]+)"/i.exec(header);
  return match?.[1] ?? FALLBACK_FILE_NAME;
}

export async function readExportResponse(response: Response, messages: ExportDownloadMessages): Promise<ExportDownload> {
  // Signed out: requireAuthContext redirects to the sign-in page, which the
  // request does not follow.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    return { ok: false, error: messages.signedOut };
  }
  const fileName = response.ok ? attachmentFileName(response.headers.get('content-disposition')) : null;
  if (fileName) {
    try {
      return { ok: true, blob: await response.blob(), fileName };
    } catch {
      return { ok: false, error: messages.failed };
    }
  }
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error) return { ok: false, error: body.error };
  } catch {
    // Not our JSON (a platform error page, for example): fall through.
  }
  return { ok: false, error: messages.failed };
}

/** Ask an export route for the brand's file. Never throws. */
export async function requestExportDownload(
  path: string,
  accountId: string,
  messages: ExportDownloadMessages,
  fetchImpl: typeof fetch = fetch,
): Promise<ExportDownload> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [EXPORT_REQUEST_HEADER]: '1' },
      body: JSON.stringify({ accountId }),
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, error: messages.failed };
  }
  return readExportResponse(response, messages);
}

/** Browser only: hand the file to the browser as a download. */
export function saveDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the link goes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
