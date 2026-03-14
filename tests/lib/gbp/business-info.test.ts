import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_FETCH = global.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

describe('GBP Business Information helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = ORIGINAL_FETCH;
  });

  it('does not call Google Business Information APIs for canonical IDs', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { resolveCanonicalLocationIdViaApi } = await import('@/lib/gbp/business-info');
    await expect(resolveCanonicalLocationIdViaApi('accounts/123/locations/456', 'token')).resolves.toBe('locations/456');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('repairs non-canonical IDs via direct lookup', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      name: 'accounts/123/locations/456',
      title: 'The Anchor',
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { resolveCanonicalLocationIdViaApi } = await import('@/lib/gbp/business-info');
    await expect(resolveCanonicalLocationIdViaApi('locations/ChIJDcbcERJxdkgReaFjdQ7fzfg', 'token')).resolves.toBe('locations/456');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records quota cooldowns and fails fast on repeated repair attempts', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      error: {
        message: 'Quota exceeded for quota metric Requests.',
        details: [{ retryDelay: '107s' }],
      },
    }, { status: 429 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GbpRateLimitError, resolveCanonicalLocationIdViaApi } = await import('@/lib/gbp/business-info');

    let firstError: unknown = null;
    try {
      await resolveCanonicalLocationIdViaApi('locations/ChIJDcbcERJxdkgReaFjdQ7fzfg', 'token');
    } catch (error) {
      firstError = error;
    }

    expect(firstError).toBeInstanceOf(GbpRateLimitError);
    expect(firstError).toMatchObject({ retryAfterSeconds: 107 });

    await expect(resolveCanonicalLocationIdViaApi('locations/ChIJDcbcERJxdkgReaFjdQ7fzfg', 'token')).rejects.toBeInstanceOf(GbpRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
