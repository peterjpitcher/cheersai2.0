import { NextResponse } from 'next/server';

/**
 * Shared plumbing for Meta's server-to-server callbacks (data deletion and
 * deauthorise). Meta posts a form field `signed_request`; JSON is accepted too
 * so the endpoints can be tested by hand.
 */
export async function readSignedRequest(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body: unknown = await request.json();
      const value = (body as { signed_request?: unknown } | null)?.signed_request;
      return typeof value === 'string' ? value : null;
    }
    const form = await request.formData();
    const value = form.get('signed_request');
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
