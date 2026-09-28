import { describe, expect, it, vi } from 'vitest';

import { attachmentFileName, readExportResponse, requestExportDownload } from '@/lib/export/download-request';
import { requestedAccountId, streamJsonDownload } from '@/lib/export/stream-response';

const BRAND = '11111111-1111-4111-8111-111111111111';
const MESSAGES = { failed: 'The export failed. Email peter@orangejelly.co.uk.', signedOut: 'You are not signed in any more.' };

describe('attachmentFileName', () => {
  it('reads the file name from a download, and nothing from anything else', () => {
    expect(attachmentFileName(`attachment; filename="cheers-export-${BRAND}.json"`)).toBe(`cheers-export-${BRAND}.json`);
    expect(attachmentFileName('attachment')).toBe('cheers-export.json');
    expect(attachmentFileName('inline; filename="x.json"')).toBeNull();
    expect(attachmentFileName(null)).toBeNull();
  });
});

describe('readExportResponse', () => {
  it('returns the file for a streamed download', async () => {
    const result = await readExportResponse(streamJsonDownload('{"posts":[]}', `cheers-export-${BRAND}.json`), MESSAGES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileName).toBe(`cheers-export-${BRAND}.json`);
      expect(await result.blob.text()).toBe('{"posts":[]}');
    }
  });

  it("shows the server's message when it refuses", async () => {
    const response = Response.json({ error: 'You can download your data 3 times a day.' }, { status: 429 });
    expect(await readExportResponse(response, MESSAGES)).toEqual({ ok: false, error: 'You can download your data 3 times a day.' });
  });

  it('never treats a 200 without a download header as the file (for example the sign-in page)', async () => {
    const response = new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    expect(await readExportResponse(response, MESSAGES)).toEqual({ ok: false, error: MESSAGES.failed });
  });

  it('says so when the person has been signed out', async () => {
    const response = new Response(null, { status: 307, headers: { location: '/auth/login' } });
    expect(await readExportResponse(response, MESSAGES)).toEqual({ ok: false, error: MESSAGES.signedOut });
  });

  it('falls back to the given message for a platform error page', async () => {
    const response = new Response('FUNCTION_INVOCATION_TIMEOUT', { status: 504 });
    expect(await readExportResponse(response, MESSAGES)).toEqual({ ok: false, error: MESSAGES.failed });
  });
});

describe('requestExportDownload', () => {
  it('posts the brand with the export header to the given route, without following redirects', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: 'nope' }, { status: 403 }));
    await requestExportDownload('/api/admin/brand-export', BRAND, MESSAGES, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/admin/brand-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cheers-export': '1' },
      body: JSON.stringify({ accountId: BRAND }),
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('shows the given message when the network fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await requestExportDownload('/api/settings/data-export', BRAND, MESSAGES, fetchImpl as unknown as typeof fetch)).toEqual({
      ok: false,
      error: MESSAGES.failed,
    });
  });
});

describe('stream-response', () => {
  it('sends a large file in several chunks that add up to the whole', async () => {
    const json = JSON.stringify({ posts: Array.from({ length: 3000 }, (_, i) => ({ id: i, body: 'x'.repeat(100) })) }, null, 2);
    const response = streamJsonDownload(json, 'cheers-export-x.json');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="cheers-export-x.json"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const reader = response.body!.getReader();
    let chunks = 0;
    let text = '';
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      text += decoder.decode(value, { stream: true });
    }
    expect(chunks).toBeGreaterThan(1);
    expect(text).toBe(json);
  });

  it('reads the brand id from the body, and null for anything else', async () => {
    const post = (body: string) => new Request('http://localhost/x', { method: 'POST', body });
    expect(await requestedAccountId(post(JSON.stringify({ accountId: BRAND })))).toBe(BRAND);
    expect(await requestedAccountId(post(JSON.stringify({ accountId: 42 })))).toBeNull();
    expect(await requestedAccountId(post('not json'))).toBeNull();
  });
});
