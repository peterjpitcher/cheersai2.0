/** GET/POST /api/cron/sync-post-results (tasks/SPEC-post-results.md). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyCronAuth: vi.fn(),
  tryCreateServiceSupabaseClient: vi.fn(),
  loadConnectedAccounts: vi.fn(),
  syncAccountPostResults: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/security/cron-auth', () => ({ verifyCronAuth: mocks.verifyCronAuth }));
vi.mock('@/lib/supabase/service', () => ({ tryCreateServiceSupabaseClient: mocks.tryCreateServiceSupabaseClient }));
vi.mock('@/lib/analytics/post-results', () => ({
  createGraphGet: () => vi.fn(),
  loadConnectedAccounts: mocks.loadConnectedAccounts,
  syncAccountPostResults: mocks.syncAccountPostResults,
}));
vi.mock('@/lib/analytics/post-results-token', () => ({ tokenForPlatform: vi.fn() }));
vi.mock('@/lib/meta/graph', () => ({ getMetaGraphApiBase: () => 'https://graph.facebook.com/v24.0' }));
vi.mock('@/lib/logging', () => ({ createLogger: () => mocks.logger }));

import { GET } from '@/app/api/cron/sync-post-results/route';

const request = (): Request => new Request('https://cheers.example.com/api/cron/sync-post-results');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyCronAuth.mockReturnValue({ authorised: true });
  mocks.tryCreateServiceSupabaseClient.mockReturnValue({ service: true });
  mocks.loadConnectedAccounts.mockResolvedValue(['acc-1', 'acc-2']);
  mocks.syncAccountPostResults.mockResolvedValue({ posts: 4, written: 3, skipped: 1, refused: {} });
});

describe('sync-post-results cron', () => {
  it('refuses a request without the cron secret', async () => {
    mocks.verifyCronAuth.mockReturnValue({ authorised: false, errorStatus: 401, errorMessage: 'Unauthorized' });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.loadConnectedAccounts).not.toHaveBeenCalled();
  });

  it('reads every connected brand and adds up the run', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.syncAccountPostResults).toHaveBeenCalledTimes(2);
    expect(mocks.syncAccountPostResults).toHaveBeenCalledWith({ db: { service: true }, accountId: 'acc-1' }, expect.objectContaining({ tokenFor: expect.any(Function) }));
    expect(await response.json()).toEqual({ brands: 2, posts: 8, written: 6, skipped: 2, failures: 0 });
  });

  it('logs what Meta refused, which usually means the reconnect', async () => {
    mocks.syncAccountPostResults.mockResolvedValueOnce({ posts: 1, written: 1, skipped: 0, refused: { post_media_view: 1 } });
    await GET(request());
    expect(mocks.logger.warn).toHaveBeenCalledWith('Meta refused some results', { accountId: 'acc-1', refused: { post_media_view: 1 } });
  });

  it('fails the run when a brand fails, and still reads the others', async () => {
    mocks.syncAccountPostResults.mockRejectedValueOnce(new Error('results could not be stored'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(mocks.syncAccountPostResults).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({ brands: 1, failures: 1 });
  });

  it('fails the run when the connections cannot be read', async () => {
    mocks.loadConnectedAccounts.mockRejectedValue(new Error('timeout'));
    const response = await GET(request());
    expect(response.status).toBe(500);
  });
});
