import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/tournaments/base-image/route';
const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/app/actions/tournament-images', () => ({ uploadTournamentBaseImage: mocks.upload }));
const origin = 'https://cheers.example.test';
function request(headers: Record<string, string> = { origin }, body: BodyInit = new FormData()): NextRequest {
  return new NextRequest(`${origin}/api/tournaments/base-image`, { method: 'POST', headers, body });
}
beforeEach(() => { vi.clearAllMocks(); mocks.upload.mockResolvedValue({ success: true }); });
describe('tournament image upload endpoint', () => {
  it.each<Record<string, string>>([{}, { origin: 'https://other.example.test' }, { origin: 'null' }])('rejects missing or foreign origins', async (headers) => {
    const response = await POST(request(headers));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining('Cheers') });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects oversized requests before parsing multipart', async () => {
    const response = await POST(request({ origin, 'content-length': String(4 * 1024 * 1024 + 64 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('passes actual multipart fields to the authenticated upload action', async () => {
    const data = new FormData();
    data.set('tournamentId', 'tournament');
    data.set('aspect', 'square');
    data.set('file', new File(['image'], 'artwork.png', { type: 'image/png' }));
    const response = await POST(request({ origin }, data));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    const parsed = mocks.upload.mock.calls[0][0] as FormData;
    expect(parsed.get('tournamentId')).toBe('tournament');
    expect(parsed.get('aspect')).toBe('square');
    expect((parsed.get('file') as File).name).toBe('artwork.png');
  });
  it('returns the upload action failure to the user', async () => {
    mocks.upload.mockResolvedValue({ success: false, error: 'Image upload failed. Please retry.' });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Image upload failed. Please retry.' });
  });
  it('handles malformed multipart without calling the upload action', async () => {
    const response = await POST(request({ origin, 'content-type': 'multipart/form-data' }, 'invalid'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Upload failed. Please retry.' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('fails closed if the upload dependency throws', async () => {
    mocks.upload.mockRejectedValue(new Error('unexpected failure'));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Upload failed. Please retry.' });
  });
});
