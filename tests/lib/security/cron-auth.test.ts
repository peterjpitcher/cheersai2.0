import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the signing module to control validateSecret behaviour
vi.mock('@/lib/security/signing', () => ({
  validateSecret: vi.fn(),
}));

const { verifyCronAuth } = await import('@/lib/security/cron-auth');
const { validateSecret } = await import('@/lib/security/signing');
const mockValidateSecret = vi.mocked(validateSecret);

describe('verifyCronAuth', () => {
  const REAL_SECRET = 'test-cron-secret-123';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = REAL_SECRET;
    // Default: validateSecret returns true when secrets match
    mockValidateSecret.mockImplementation(
      (provided, expected) => provided === expected,
    );
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('should return 500 when CRON_SECRET is not configured', () => {
    delete process.env.CRON_SECRET;

    const request = new Request('https://example.com/api/cron/test', {
      headers: { 'x-cron-secret': REAL_SECRET },
    });

    const result = verifyCronAuth(request);
    expect(result.authorised).toBe(false);
    expect(result.errorStatus).toBe(500);
    expect(result.errorMessage).toBe('CRON_SECRET not configured');
  });

  it('should authorise when x-cron-secret header matches', () => {
    const request = new Request('https://example.com/api/cron/test', {
      headers: { 'x-cron-secret': REAL_SECRET },
    });

    const result = verifyCronAuth(request);
    expect(result.authorised).toBe(true);
    expect(result.errorStatus).toBeUndefined();
  });

  it('should authorise when Authorization Bearer header matches', () => {
    const request = new Request('https://example.com/api/cron/test', {
      headers: { Authorization: `Bearer ${REAL_SECRET}` },
    });

    const result = verifyCronAuth(request);
    expect(result.authorised).toBe(true);
  });

  it('should handle case-insensitive Bearer prefix', () => {
    const request = new Request('https://example.com/api/cron/test', {
      headers: { Authorization: `bearer ${REAL_SECRET}` },
    });

    const result = verifyCronAuth(request);
    expect(result.authorised).toBe(true);
  });

  it('should reject when no auth headers are provided', () => {
    const request = new Request('https://example.com/api/cron/test');

    const result = verifyCronAuth(request);
    expect(result.authorised).toBe(false);
    expect(result.errorStatus).toBe(401);
    expect(result.errorMessage).toBe('Unauthorized');
  });

  it('should reject when header secret is wrong', () => {
    mockValidateSecret.mockReturnValue(false);

    const request = new Request('https://example.com/api/cron/test', {
      headers: { 'x-cron-secret': 'wrong-secret' },
    });

    const result = verifyCronAuth(request);
    expect(result.authorised).toBe(false);
    expect(result.errorStatus).toBe(401);
  });

  it('should NOT accept secrets via URL query string', () => {
    // URL has the correct secret, but no headers -- must be rejected
    const request = new Request(
      `https://example.com/api/cron/test?secret=${REAL_SECRET}`,
    );

    const result = verifyCronAuth(request);
    expect(result.authorised).toBe(false);
    expect(result.errorStatus).toBe(401);
  });

  it('should use timing-safe comparison via validateSecret', () => {
    const request = new Request('https://example.com/api/cron/test', {
      headers: { 'x-cron-secret': REAL_SECRET },
    });

    verifyCronAuth(request);

    expect(mockValidateSecret).toHaveBeenCalledWith(REAL_SECRET, REAL_SECRET);
  });

  it('should prefer x-cron-secret over Authorization header', () => {
    const request = new Request('https://example.com/api/cron/test', {
      headers: {
        'x-cron-secret': REAL_SECRET,
        Authorization: 'Bearer wrong-secret',
      },
    });

    const result = verifyCronAuth(request);
    expect(result.authorised).toBe(true);
    // validateSecret should have been called with x-cron-secret value
    expect(mockValidateSecret).toHaveBeenCalledWith(REAL_SECRET, REAL_SECRET);
  });

  it('should trim whitespace from header values', () => {
    const request = new Request('https://example.com/api/cron/test', {
      headers: { 'x-cron-secret': `  ${REAL_SECRET}  ` },
    });

    verifyCronAuth(request);

    expect(mockValidateSecret).toHaveBeenCalledWith(REAL_SECRET, REAL_SECRET);
  });
});
