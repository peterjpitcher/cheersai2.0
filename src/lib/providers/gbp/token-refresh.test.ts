import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorClassification } from '@/lib/providers/errors';

// Mock dependencies before importing module under test
vi.mock('@/lib/providers/token-helpers', () => ({
  getDecryptedToken: vi.fn(),
  storeEncryptedToken: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceSupabaseClient: vi.fn(),
}));

vi.mock('@/env', () => ({
  env: {
    server: {
      GOOGLE_MY_BUSINESS_CLIENT_ID: 'test-client-id',
      GOOGLE_MY_BUSINESS_CLIENT_SECRET: 'test-client-secret',
    },
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { ensureFreshGbpToken } from './token-refresh';
import { getDecryptedToken, storeEncryptedToken } from '@/lib/providers/token-helpers';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

function createMockSupabase(tokenExpiresAt: string | null) {
  const single = vi.fn().mockResolvedValue({
    data: { token_expires_at: tokenExpiresAt },
    error: null,
  });
  const eq2 = vi.fn().mockReturnValue({ single });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });

  const updateEq2 = vi.fn().mockResolvedValue({ error: null });
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 });
  const update = vi.fn().mockReturnValue({ eq: updateEq1 });

  return {
    from: vi.fn((table: string) => {
      if (table === 'social_connections') {
        return { select, update };
      }
      return { select, update };
    }),
  };
}

describe('ensureFreshGbpToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return existing token when not expired (30 min remaining)', async () => {
    // Token expires in 30 minutes -- well outside the 5 minute buffer
    const expiresAt = new Date('2026-01-15T12:30:00Z').toISOString();
    const mockSupa = createMockSupabase(expiresAt);
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupa as never);
    vi.mocked(getDecryptedToken).mockResolvedValue('existing-access-token');

    const result = await ensureFreshGbpToken('conn-123');

    expect(result).toBe('existing-access-token');
    expect(getDecryptedToken).toHaveBeenCalledWith('conn-123', 'access');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(storeEncryptedToken).not.toHaveBeenCalled();
  });

  it('should refresh token when within 5 minutes of expiry', async () => {
    // Token expires in 3 minutes -- within the 5 minute buffer
    const expiresAt = new Date('2026-01-15T12:03:00Z').toISOString();
    const mockSupa = createMockSupabase(expiresAt);
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupa as never);
    vi.mocked(getDecryptedToken).mockResolvedValue('test-refresh-token');

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        access_token: 'new-access-token',
        expires_in: 3600,
      }),
    });

    const result = await ensureFreshGbpToken('conn-123');

    expect(result).toBe('new-access-token');
    expect(getDecryptedToken).toHaveBeenCalledWith('conn-123', 'refresh');
    expect(mockFetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST',
    }));
    expect(storeEncryptedToken).toHaveBeenCalledWith('conn-123', 'access', 'new-access-token');
  });

  it('should refresh token when token_expires_at is null', async () => {
    const mockSupa = createMockSupabase(null);
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupa as never);
    vi.mocked(getDecryptedToken).mockResolvedValue('test-refresh-token');

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        access_token: 'refreshed-token',
        expires_in: 3600,
      }),
    });

    const result = await ensureFreshGbpToken('conn-null');

    expect(result).toBe('refreshed-token');
    expect(mockFetch).toHaveBeenCalled();
    expect(storeEncryptedToken).toHaveBeenCalledWith('conn-null', 'access', 'refreshed-token');
  });

  it('should throw ProviderError with AUTH classification on refresh failure', async () => {
    const expiresAt = new Date('2026-01-15T12:01:00Z').toISOString();
    const mockSupa = createMockSupabase(expiresAt);
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupa as never);
    vi.mocked(getDecryptedToken).mockResolvedValue('bad-refresh-token');

    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: 'invalid_grant' }),
    });

    await expect(ensureFreshGbpToken('conn-fail')).rejects.toMatchObject({
      name: 'ProviderError',
      classification: ErrorClassification.AUTH,
    });
  });

  it('should update token_expires_at on social_connections after refresh', async () => {
    const expiresAt = new Date('2026-01-15T12:02:00Z').toISOString();
    const mockSupa = createMockSupabase(expiresAt);
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockSupa as never);
    vi.mocked(getDecryptedToken).mockResolvedValue('test-refresh-token');

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        access_token: 'new-token',
        expires_in: 3600,
      }),
    });

    await ensureFreshGbpToken('conn-update');

    // Verify update was called on social_connections
    expect(mockSupa.from).toHaveBeenCalledWith('social_connections');
  });
});

describe('validateGbpContent', () => {
  // Import lazily to avoid circular issues
  let validateGbpContent: typeof import('./validation').validateGbpContent;

  beforeEach(async () => {
    const mod = await import('./validation');
    validateGbpContent = mod.validateGbpContent;
  });

  it('should return error for text exceeding 1500 chars', () => {
    const result = validateGbpContent({
      text: 'a'.repeat(1501),
      contentType: 'instant_post',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'GBP_TEXT_TOO_LONG' }));
  });

  it('should return error for story content type', () => {
    const result = validateGbpContent({
      text: 'Hello',
      contentType: 'story',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'GBP_STORIES_NOT_SUPPORTED' }));
  });

  it('should return error for event without title', () => {
    const result = validateGbpContent({
      text: 'Event post',
      contentType: 'event',
      eventDetails: { title: '', startDate: '2026-01-20', endDate: '2026-01-21' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'GBP_EVENT_NO_TITLE' }));
  });

  it('should return error for event without startDate', () => {
    const result = validateGbpContent({
      text: 'Event post',
      contentType: 'event',
      eventDetails: { title: 'My Event', startDate: '', endDate: '2026-01-21' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'GBP_EVENT_NO_START' }));
  });

  it('should return error for event without endDate', () => {
    const result = validateGbpContent({
      text: 'Event post',
      contentType: 'event',
      eventDetails: { title: 'My Event', startDate: '2026-01-20', endDate: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'GBP_EVENT_NO_END' }));
  });

  it('should return error for promotion without couponCode', () => {
    const result = validateGbpContent({
      text: 'Promo post',
      contentType: 'promotion',
      offerDetails: { couponCode: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'GBP_PROMO_NO_COUPON' }));
  });

  it('should return error for instant_post without text', () => {
    const result = validateGbpContent({
      text: '',
      contentType: 'instant_post',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'GBP_POST_NO_TEXT' }));
  });

  it('should pass validation for valid instant_post', () => {
    const result = validateGbpContent({
      text: 'Hello from our pub!',
      contentType: 'instant_post',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass validation for valid event', () => {
    const result = validateGbpContent({
      text: 'Join us!',
      contentType: 'event',
      eventDetails: { title: 'Quiz Night', startDate: '2026-01-20', endDate: '2026-01-20' },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
