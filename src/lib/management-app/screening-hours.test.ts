import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchScreeningHours, unknownScreeningHours } from './screening-hours';
const config = { baseUrl: 'https://management.example.test', apiKey: 'test-key' };
afterEach(() => vi.unstubAllGlobals());
describe('strict screening hours client', () => {
  it('reads the exact authenticated no-store endpoint and validates every requested date', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { schemaVersion: 1, timezone: 'Europe/London', days: [unknownScreeningHours('2026-11-07')] } }));
    vi.stubGlobal('fetch', fetch);
    expect((await fetchScreeningHours(['2026-11-07'], config)).days).toHaveLength(1);
    expect(String(fetch.mock.calls[0][0])).toContain('/api/business/screening-hours?dates=2026-11-07');
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', redirect: 'error', headers: { 'X-API-Key': 'test-key' } });
  });
  it.each([{ success: false }, { success: true, data: { schemaVersion: 1, timezone: 'Europe/London', days: [] } }])('rejects failed or incomplete envelopes', async payload => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(fetchScreeningHours(['2026-11-07'], config)).rejects.toThrow();
  });
  it('rejects impossible dates before fetching', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchScreeningHours(['2026-02-30'], config)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
