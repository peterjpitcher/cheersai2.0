/**
 * PR10 (3c) — QStash food-materialise worker route.
 *
 * Covers signature rejection, payload validation, happy-path creation (+ cache revalidation),
 * idempotency (a re-delivered message creates nothing), and the 500-on-error retry contract.
 * The materialise helper, QStash signature check, logging, and next/cache are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/qstash/client', () => ({
  verifyQStashSignature: vi.fn(),
}));

vi.mock('@/lib/campaigns/food-materialise', () => ({
  materialiseFoodWindowsForCampaign: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// Mutable featureFlags so the F1 kill-switch test can flip FOOD_AUTO_MATERIALISE_ENABLED off.
// Defaults ON here (beforeEach) so the rest of the suite exercises the normal path.
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, foodAutoMaterialise: true },
  };
});

import { verifyQStashSignature } from '@/lib/qstash/client';
import { materialiseFoodWindowsForCampaign } from '@/lib/campaigns/food-materialise';
import { revalidatePath } from 'next/cache';
import { featureFlags } from '@/env';
import { POST } from './route';

const REFERENCE_ISO = '2026-06-14T01:00:00.000Z';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/webhooks/qstash-food-materialise', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'upstash-signature': 'sig' }),
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlags.foodAutoMaterialise = true;
});

describe('qstash-food-materialise worker route', () => {
  it('F1 kill switch: a signed, replayed job is skipped with 200 when the flag is off (no DB/Meta work)', async () => {
    featureFlags.foodAutoMaterialise = false;
    vi.mocked(verifyQStashSignature).mockResolvedValue(true);

    const res = await POST(makeRequest({ campaignId: 'c-1', referenceIso: REFERENCE_ISO }));
    const body = await res.json();

    // 200 — a deliberately disabled job must NOT be retried by QStash.
    expect(res.status).toBe(200);
    expect(body).toEqual({ skipped: true });
    // The kill switch halts ALL work: no materialisation (DB/Meta) and no cache busting.
    expect(materialiseFoodWindowsForCampaign).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects an invalid QStash signature with 401 and does not materialise', async () => {
    vi.mocked(verifyQStashSignature).mockResolvedValue(false);

    const res = await POST(makeRequest({ campaignId: 'c-1', referenceIso: REFERENCE_ISO }));

    expect(res.status).toBe(401);
    expect(materialiseFoodWindowsForCampaign).not.toHaveBeenCalled();
  });

  it('returns 400 when campaignId or referenceIso is missing', async () => {
    vi.mocked(verifyQStashSignature).mockResolvedValue(true);

    const res = await POST(makeRequest({ campaignId: 'c-1' }));

    expect(res.status).toBe(400);
    expect(materialiseFoodWindowsForCampaign).not.toHaveBeenCalled();
  });

  it('materialises the next week and revalidates caches on success', async () => {
    vi.mocked(verifyQStashSignature).mockResolvedValue(true);
    vi.mocked(materialiseFoodWindowsForCampaign).mockResolvedValue({
      created: 4,
      serviceDates: ['2026-06-28'],
    });

    const res = await POST(makeRequest({ campaignId: 'c-1', referenceIso: REFERENCE_ISO }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ created: 4, serviceDates: ['2026-06-28'] });
    expect(materialiseFoodWindowsForCampaign).toHaveBeenCalledWith({
      campaignId: 'c-1',
      referenceIso: REFERENCE_ISO,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/campaigns');
    expect(revalidatePath).toHaveBeenCalledWith('/campaigns/c-1');
  });

  it('is idempotent: a re-delivered message creates nothing and skips cache revalidation', async () => {
    vi.mocked(verifyQStashSignature).mockResolvedValue(true);
    // Helper enforces idempotency internally; the worker reports created: 0 and does not bust caches.
    vi.mocked(materialiseFoodWindowsForCampaign).mockResolvedValue({ created: 0, serviceDates: [] });

    const res = await POST(makeRequest({ campaignId: 'c-1', referenceIso: REFERENCE_ISO }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ created: 0, serviceDates: [] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns 500 when materialisation throws so QStash retries', async () => {
    vi.mocked(verifyQStashSignature).mockResolvedValue(true);
    vi.mocked(materialiseFoodWindowsForCampaign).mockRejectedValue(new Error('Meta down'));

    const res = await POST(makeRequest({ campaignId: 'c-1', referenceIso: REFERENCE_ISO }));

    expect(res.status).toBe(500);
  });
});
