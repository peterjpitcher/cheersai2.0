import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkManagementConnection } from '@/lib/management-app/connection-check';

const config = { baseUrl: 'https://management.example.com', apiKey: 'test-only' };

function installResponses(failPath?: string, noEvents = false) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.method).toBe('GET');
    const path = new URL(url).pathname;
    if (path === failPath) return Response.json({ success: false }, { status: 500 });
    const data = path === '/api/events' ? { events: noEvents ? [] : [{ id: '4b73c99c-15be-45c4-951a-6a3f63cb25ab', name: 'Quiz' }] }
      : path === '/api/menu/specials' ? { specials: [] }
      : path.includes('event-booking-conversions') ? { conversions: [] }
      : path.endsWith('/artwork') ? { eventId: '4b73c99c-15be-45c4-951a-6a3f63cb25ab', variants: {} }
      : { id: '4b73c99c-15be-45c4-951a-6a3f63cb25ab', name: 'Quiz' };
    return Response.json({ success: true, data });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('management connection check', () => {
  it('checks every read capability without writing', async () => {
    const fetchMock = installResponses();
    expect(await checkManagementConnection(config)).toContain('booking conversions passed');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it.each(['/api/menu/specials', '/api/marketing/event-booking-conversions', '/api/events/4b73c99c-15be-45c4-951a-6a3f63cb25ab', '/api/events/4b73c99c-15be-45c4-951a-6a3f63cb25ab/artwork'])(
    'does not report success when %s fails after the event list succeeds', async (path) => {
      installResponses(path);
      await expect(checkManagementConnection(config)).rejects.toThrow();
    },
  );

  it('rejects a malformed event list instead of reporting an empty healthy feed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: {} })));
    await expect(checkManagementConnection(config)).rejects.toThrow('Event list response was invalid');
  });

  it('reports the capabilities that cannot be checked with an empty event list', async () => {
    const fetchMock = installResponses(undefined, true);
    expect(await checkManagementConnection(config)).toContain('could not be checked because there are no events');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain('00000000-0000-0000-0000-000000000000');
  });
});
