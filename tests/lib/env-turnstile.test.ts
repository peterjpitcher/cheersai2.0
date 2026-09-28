import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * src/env.ts checks production builds (Production and Preview alike) when it
 * loads. The Turnstile keys for /signup are required there, and Cloudflare's
 * published test keys are refused in Production (spec §4.2 step 3, §5 PR 5).
 */

const REQUIRED = {
  NODE_ENV: 'production',
  SKIP_ENV_VALIDATION: '',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  NEXT_PUBLIC_SITE_URL: 'https://cheers.orangejelly.co.uk',
  CRON_SECRET: 'cron',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  FACEBOOK_APP_SECRET: 'fb',
  TOKEN_VAULT_KEY: 'ab'.repeat(32),
  RESEND_API_KEY: 're_test',
  RESEND_FROM: 'Cheers <auth@example.test>',
  OPERATOR_ALERT_EMAIL: 'ops@example.test',
  OPENAI_API_KEY: 'sk-test',
};

const REAL_SITE_KEY = '0x4AAAAAAAexampleSiteKey';
const REAL_SECRET = '0x4AAAAAAAexampleSecretKey';
const TEST_SITE_KEY = '1x00000000000000000000AA';
const TEST_SECRET = '1x0000000000000000000000000000000AA';

async function loadEnv(extra: Record<string, string>): Promise<unknown> {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...REQUIRED, ...extra })) vi.stubEnv(key, value);
  return import('@/env');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('env validation: Turnstile keys', () => {
  it('fails a production build without the Turnstile secret or site key', async () => {
    await expect(loadEnv({ VERCEL_ENV: 'production', NEXT_PUBLIC_TURNSTILE_SITE_KEY: REAL_SITE_KEY, TURNSTILE_SECRET_KEY: '' })).rejects.toThrow(
      /TURNSTILE_SECRET_KEY/,
    );
    await expect(loadEnv({ VERCEL_ENV: 'preview', NEXT_PUBLIC_TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: TEST_SECRET })).rejects.toThrow(
      /NEXT_PUBLIC_TURNSTILE_SITE_KEY/,
    );
  });

  it('accepts real keys in Production', async () => {
    await expect(
      loadEnv({ VERCEL_ENV: 'production', NEXT_PUBLIC_TURNSTILE_SITE_KEY: REAL_SITE_KEY, TURNSTILE_SECRET_KEY: REAL_SECRET }),
    ).resolves.toBeTruthy();
  });

  it("refuses Cloudflare's test keys in Production", async () => {
    await expect(
      loadEnv({ VERCEL_ENV: 'production', NEXT_PUBLIC_TURNSTILE_SITE_KEY: REAL_SITE_KEY, TURNSTILE_SECRET_KEY: TEST_SECRET }),
    ).rejects.toThrow(/test keys/);
    await expect(
      loadEnv({ VERCEL_ENV: 'production', NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET_KEY: REAL_SECRET }),
    ).rejects.toThrow(/test keys/);
  });

  it("accepts Cloudflare's test keys in Preview", async () => {
    await expect(
      loadEnv({ VERCEL_ENV: 'preview', NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET_KEY: TEST_SECRET }),
    ).resolves.toBeTruthy();
  });

  it('skips the check when SKIP_ENV_VALIDATION=1 (CI builds)', async () => {
    await expect(loadEnv({ SKIP_ENV_VALIDATION: '1', NEXT_PUBLIC_TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' })).resolves.toBeTruthy();
  });

  it('recognises every published test key and no real one', async () => {
    const { TURNSTILE_TEST_KEY_PATTERN } = (await loadEnv({
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY,
      TURNSTILE_SECRET_KEY: TEST_SECRET,
    })) as { TURNSTILE_TEST_KEY_PATTERN: RegExp };
    for (const key of [
      '1x00000000000000000000AA',
      '2x00000000000000000000AB',
      '1x00000000000000000000BB',
      '2x00000000000000000000BB',
      '3x00000000000000000000FF',
      '1x0000000000000000000000000000000AA',
      '2x0000000000000000000000000000000AA',
      '3x0000000000000000000000000000000AA',
    ]) {
      expect(TURNSTILE_TEST_KEY_PATTERN.test(key), key).toBe(true);
    }
    expect(TURNSTILE_TEST_KEY_PATTERN.test(REAL_SITE_KEY)).toBe(false);
    expect(TURNSTILE_TEST_KEY_PATTERN.test(REAL_SECRET)).toBe(false);
  });
});
