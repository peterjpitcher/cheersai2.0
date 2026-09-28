/**
 * Server side of the brand export downloads (see download-request.ts).
 *
 * The file is built in full before this is called, so a failure is a clean
 * error rather than half a file, then sent a chunk at a time. A streamed
 * response is not subject to Vercel's 4.5 MB limit on function responses,
 * which a large brand's export passes (measured on the local stack on 28
 * September 2026: 5,000 posts and 3,000 media items came to about 5.3 MB with
 * their signed media links).
 */

const CHUNK_BYTES = 64 * 1024;

/** A refusal the download helper shows as it is. */
export function exportRefusal(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** The export as a JSON download, streamed in chunks. */
export function streamJsonDownload(json: string, fileName: string): Response {
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

/** The brand id the page sent in the request body, or null. */
export async function requestedAccountId(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { accountId?: unknown } | null;
    return typeof body?.accountId === 'string' ? body.accountId : null;
  } catch {
    return null;
  }
}
