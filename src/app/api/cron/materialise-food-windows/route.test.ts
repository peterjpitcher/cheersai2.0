/**
 * PR10 (3c) — weekly food-window materialisation cron route.
 *
 * Covers the critical safety properties: auth rejection, flag-off pure no-op (no dispatch, no
 * campaign load), and flag-on fan-out (one dedup'd QStash job per active rolling food campaign).
 * QStash client, Supabase, logging, and @/env are mocked — no live calls.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPublishJSON = vi.fn();

vi.mock('@/lib/qstash/client', () => ({
  getQStashClient: vi.fn(() => ({ publishJSON: mockPublishJSON })),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// Mutable featureFlags so individual tests toggle FOOD_AUTO_MATERIALISE_ENABLED; pin the site URL.
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    ...actual,
    env: { ...actual.env, client: { ...actual.env.client, NEXT_PUBLIC_SITE_URL: 'https://app.cheersai.com' } },
    featureFlags: { ...actual.featureFlags, foodAutoMaterialise: false },
  };
});

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { featureFlags } from '@/env';
import { GET } from './route';

interface CampaignRow {
  id: string;
  account_id: string;
}

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret';
});

beforeEach(() => {
  vi.clearAllMocks();
  featureFlags.foodAutoMaterialise = false;
  mockPublishJSON.mockResolvedValue({ messageId: 'msg-1' });
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/materialise-food-windows', {
    method: 'GET',
    headers: new Headers(headers),
  });
}

/** Supabase stub whose meta_campaigns query chain resolves to the given rows. */
function setupCampaigns(rows: CampaignRow[], error: { message: string } | null = null) {
  const not = vi.fn().mockResolvedValue({ data: rows, error });
  const eqStatus = vi.fn(() => ({ not }));
  const eqKind = vi.fn(() => ({ eq: eqStatus }));
  const select = vi.fn(() => ({ eq: eqKind }));
  const from = vi.fn(() => ({ select }));
  vi.mocked(createServiceSupabaseClient).mockReturnValue({ from } as never);
  return { from };
}

describe('materialise-food-windows cron route', () => {
  describe('authentication', () => {
    it('returns 401 when no secret is provided', async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
      expect(mockPublishJSON).not.toHaveBeenCalled();
    });

    it('returns 401 when the wrong secret is provided', async () => {
      const res = await GET(makeRequest({ 'x-cron-secret': 'wrong' }));
      expect(res.status).toBe(401);
      expect(mockPublishJSON).not.toHaveBeenCalled();
    });
  });

  describe('flag off (default)', () => {
    it('is a pure no-op: returns { skipped: true }, no campaign load, no dispatch', async () => {
      const supa = setupCampaigns([{ id: 'c-1', account_id: 'a-1' }]);
      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ skipped: true });
      // Neither the DB nor QStash is touched when the flag is off.
      expect(supa.from).not.toHaveBeenCalled();
      expect(mockPublishJSON).not.toHaveBeenCalled();
    });
  });

  describe('flag on', () => {
    it('dispatches exactly one dedup\'d job per active rolling food campaign', async () => {
      featureFlags.foodAutoMaterialise = true;
      setupCampaigns([
        { id: 'c-1', account_id: 'a-1' },
        { id: 'c-2', account_id: 'a-2' },
      ]);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.dispatched).toBe(2);
      expect(mockPublishJSON).toHaveBeenCalledTimes(2);

      const calls = mockPublishJSON.mock.calls.map((c) => c[0]);
      // Worker endpoint + per-campaign payload.
      expect(calls[0]).toEqual(
        expect.objectContaining({
          url: 'https://app.cheersai.com/api/webhooks/qstash-food-materialise',
          retries: 3,
          body: expect.objectContaining({ campaignId: 'c-1' }),
        }),
      );
      // Dedup id is `${campaignId}:${isoWeek}` — assert the shape and that ids differ per campaign.
      const dedups = calls.map((c) => c.deduplicationId as string);
      expect(dedups[0]).toMatch(/^c-1:\d{4}-W\d{2}$/);
      expect(dedups[1]).toMatch(/^c-2:\d{4}-W\d{2}$/);
      // Each job carries a referenceIso for the worker's deterministic week selection.
      expect(typeof (calls[0].body as { referenceIso?: unknown }).referenceIso).toBe('string');
    });

    it('returns { dispatched: 0 } when there are no active rolling food campaigns', async () => {
      featureFlags.foodAutoMaterialise = true;
      setupCampaigns([]);

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      expect(body.dispatched).toBe(0);
      expect(mockPublishJSON).not.toHaveBeenCalled();
    });

    it('continues past a campaign whose dispatch fails and counts only successes', async () => {
      featureFlags.foodAutoMaterialise = true;
      setupCampaigns([
        { id: 'c-1', account_id: 'a-1' },
        { id: 'c-2', account_id: 'a-2' },
      ]);
      mockPublishJSON
        .mockRejectedValueOnce(new Error('QStash unavailable'))
        .mockResolvedValueOnce({ messageId: 'msg-2' });

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      // F8: partial failure stays 200 with counts — only TOTAL failure escalates.
      expect(res.status).toBe(200);
      expect(body.dispatched).toBe(1);
      expect(body.failed).toBe(1);
    });

    it('F8: returns 500 when every dispatch fails so the outage is not swallowed', async () => {
      featureFlags.foodAutoMaterialise = true;
      setupCampaigns([
        { id: 'c-1', account_id: 'a-1' },
        { id: 'c-2', account_id: 'a-2' },
      ]);
      mockPublishJSON.mockRejectedValue(new Error('QStash unavailable'));

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.dispatched).toBe(0);
      expect(body.failed).toBe(2);
      expect(body.error).toBeTruthy();
    });

    it('returns 500 when the campaign query errors', async () => {
      featureFlags.foodAutoMaterialise = true;
      setupCampaigns([], { message: 'db down' });

      const res = await GET(makeRequest({ 'x-cron-secret': 'test-secret' }));
      expect(res.status).toBe(500);
      expect(mockPublishJSON).not.toHaveBeenCalled();
    });
  });
});
