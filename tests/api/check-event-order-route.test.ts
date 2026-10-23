/**
 * GET/POST /api/cron/check-event-order: the daily check of the event-order rule
 * (tasks/SPEC-daily-event-order-check.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tryCreateServiceSupabaseClientMock, checkAccountEventOrderMock, verifyCronAuthMock, logger } = vi.hoisted(() => ({
  tryCreateServiceSupabaseClientMock: vi.fn(),
  checkAccountEventOrderMock: vi.fn(),
  verifyCronAuthMock: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: tryCreateServiceSupabaseClientMock }));
vi.mock('@/lib/content/event-order-check', () => ({ checkAccountEventOrder: checkAccountEventOrderMock }));
vi.mock('@/lib/security/cron-auth', () => ({ verifyCronAuth: verifyCronAuthMock }));
vi.mock('@/lib/logging', () => ({ createLogger: () => logger }));

import { GET, POST } from '@/app/api/cron/check-event-order/route';

function serviceWith(connections: unknown[] | null, error: { message: string } | null = null) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    }),
    returns: vi.fn().mockResolvedValue({ data: connections, error }),
  };
  const service = { from: vi.fn(() => builder) };
  tryCreateServiceSupabaseClientMock.mockReturnValue(service);
  return { service, filters };
}

const request = (): Request => new Request('https://cheers.orangejelly.co.uk/api/cron/check-event-order');

const SUMMARY = { campaigns: 2, posts: 9, flagged: 0, notified: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  verifyCronAuthMock.mockReturnValue({ authorised: true });
  checkAccountEventOrderMock.mockResolvedValue(SUMMARY);
});

describe('check-event-order cron', () => {
  it('refuses a request without the cron secret and checks nothing', async () => {
    verifyCronAuthMock.mockReturnValue({ authorised: false, errorStatus: 401, errorMessage: 'Unauthorized' });
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(tryCreateServiceSupabaseClientMock).not.toHaveBeenCalled();
    expect(checkAccountEventOrderMock).not.toHaveBeenCalled();
  });

  it('checks every brand with an enabled events-system connection', async () => {
    const { service, filters } = serviceWith([
      { account_id: 'acc-anchor', base_url: 'https://management.example.com', api_key: 'fixture-key-1' },
      { account_id: 'acc-other', base_url: ' https://other.example.com ', api_key: 'fixture-key-2' },
    ]);
    const response = await POST(request());

    expect(service.from).toHaveBeenCalledWith('management_app_connections');
    expect(filters).toEqual([['enabled', true]]);
    expect(checkAccountEventOrderMock).toHaveBeenCalledWith({
      db: service,
      accountId: 'acc-anchor',
      config: { baseUrl: 'https://management.example.com', apiKey: 'fixture-key-1' },
    });
    expect(checkAccountEventOrderMock).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acc-other',
      config: { baseUrl: 'https://other.example.com', apiKey: 'fixture-key-2' },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ brands: 2, campaigns: 4, posts: 18, flagged: 0, notified: 0, failures: 0 });
  });

  it('logs the posts that break the rule', async () => {
    serviceWith([{ account_id: 'acc-anchor', base_url: 'https://management.example.com', api_key: 'fixture-key-1' }]);
    checkAccountEventOrderMock.mockResolvedValue({ campaigns: 1, posts: 3, flagged: 2, notified: 1 });
    await GET(request());

    expect(logger.warn).toHaveBeenCalledWith('scheduled posts break the event-order rule', {
      accountId: 'acc-anchor',
      campaigns: 1,
      posts: 3,
      flagged: 2,
      notified: 1,
    });
  });

  it('fails the run when a brand cannot be checked, and still checks the others', async () => {
    serviceWith([
      { account_id: 'acc-down', base_url: 'https://down.example.com', api_key: 'fixture-key-1' },
      { account_id: 'acc-anchor', base_url: 'https://management.example.com', api_key: 'fixture-key-2' },
    ]);
    checkAccountEventOrderMock.mockRejectedValueOnce(new Error('events system unavailable'));
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(checkAccountEventOrderMock).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({ brands: 1, failures: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      'event-order check failed for a brand',
      expect.objectContaining({ message: 'events system unavailable' }),
      { accountId: 'acc-down' },
    );
  });

  it('fails the run for an enabled connection with no address or key', async () => {
    serviceWith([{ account_id: 'acc-half', base_url: 'https://management.example.com', api_key: ' ' }]);
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(checkAccountEventOrderMock).not.toHaveBeenCalled();
  });

  it('fails the run when the connections cannot be read', async () => {
    serviceWith(null, { message: 'timeout' });
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(checkAccountEventOrderMock).not.toHaveBeenCalled();
  });

  it('never puts a key in its logs', async () => {
    serviceWith([{ account_id: 'acc-anchor', base_url: 'https://management.example.com', api_key: 'fixture-key-1' }]);
    checkAccountEventOrderMock.mockRejectedValue(new Error('events system unavailable'));
    await GET(request());

    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(logged).not.toContain('fixture-key-1');
  });
});
