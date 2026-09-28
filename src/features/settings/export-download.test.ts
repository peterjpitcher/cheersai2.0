import { describe, expect, it, vi } from 'vitest';

import { attachmentFileName, readExportResponse, requestOwnerExport } from '@/features/settings/export-download';

const BRAND = '11111111-1111-4111-8111-111111111111';

describe('attachmentFileName', () => {
  it('reads the file name from a download, and nothing from anything else', () => {
    expect(attachmentFileName(`attachment; filename="cheers-export-${BRAND}.json"`)).toBe(`cheers-export-${BRAND}.json`);
    expect(attachmentFileName('attachment')).toBe('cheers-export.json');
    expect(attachmentFileName('inline; filename="x.json"')).toBeNull();
    expect(attachmentFileName(null)).toBeNull();
  });
});

describe('readExportResponse', () => {
  it('returns the file for a download', async () => {
    const response = new Response('{"posts":[]}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="cheers-export-${BRAND}.json"` },
    });
    const result = await readExportResponse(response);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileName).toBe(`cheers-export-${BRAND}.json`);
      expect(await result.blob.text()).toBe('{"posts":[]}');
    }
  });

  it("shows the server's message when it refuses", async () => {
    const response = Response.json({ error: 'You can download your data 3 times a day.' }, { status: 429 });
    expect(await readExportResponse(response)).toEqual({ ok: false, error: 'You can download your data 3 times a day.' });
  });

  it('never treats a 200 without a download header as the file (for example the sign-in page)', async () => {
    const response = new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const result = await readExportResponse(response);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('peter@orangejelly.co.uk') });
  });

  it('asks a signed-out owner to sign in again', async () => {
    const response = new Response(null, { status: 307, headers: { location: '/auth/login' } });
    expect(await readExportResponse(response)).toEqual({ ok: false, error: expect.stringContaining('not signed in') });
  });

  it('falls back to our message and address for a platform error page', async () => {
    const response = new Response('FUNCTION_INVOCATION_TIMEOUT', { status: 504 });
    expect(await readExportResponse(response)).toEqual({ ok: false, error: expect.stringContaining('peter@orangejelly.co.uk') });
  });
});

describe('requestOwnerExport', () => {
  it('posts the page brand with the Settings header, without following redirects', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: 'nope' }, { status: 403 }));
    await requestOwnerExport(BRAND, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/settings/data-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cheers-owner-export': '1' },
      body: JSON.stringify({ accountId: BRAND }),
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('shows our message when the network fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await requestOwnerExport(BRAND, fetchImpl as unknown as typeof fetch)).toEqual({
      ok: false,
      error: expect.stringContaining('peter@orangejelly.co.uk'),
    });
  });
});
