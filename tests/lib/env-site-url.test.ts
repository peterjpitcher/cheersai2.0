import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * src/env.ts refuses a production start whose NEXT_PUBLIC_SITE_URL is a local
 * address: every emailed link and OAuth redirect is built from it.
 */

const REQUIRED = {
  NODE_ENV: 'production',
  SKIP_ENV_VALIDATION: '',
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  CRON_SECRET: 'cron',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  FACEBOOK_APP_SECRET: 'fb',
  TOKEN_VAULT_KEY: 'ab'.repeat(32),
  RESEND_API_KEY: 're_test',
  RESEND_FROM: 'Cheers <auth@example.test>',
  OPERATOR_ALERT_EMAIL: 'ops@example.test',
  OPENAI_API_KEY: 'sk-test',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAexampleSiteKey',
  TURNSTILE_SECRET_KEY: '0x4AAAAAAAexampleSecretKey',
};

async function loadEnv(siteUrl: string): Promise<unknown> {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...REQUIRED, NEXT_PUBLIC_SITE_URL: siteUrl })) vi.stubEnv(key, value);
  return import('@/env');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('env validation: NEXT_PUBLIC_SITE_URL', () => {
  it('accepts the deployed domain', async () => {
    await expect(loadEnv('https://cheers.orangejelly.co.uk')).resolves.toBeTruthy();
  });

  it.each(['http://localhost:3000', 'https://cheersml.localhost', 'http://127.0.0.1:3000', 'https://127.0.0.1'])(
    'refuses a local address in production: %s',
    async (siteUrl) => {
      await expect(loadEnv(siteUrl)).rejects.toThrow(/NEXT_PUBLIC_SITE_URL must be set to the deployed domain/);
    },
  );

  it('refuses the http://localhost:3000 fallback used when the variable is unset', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(REQUIRED)) vi.stubEnv(key, value);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined);
    await expect(import('@/env')).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});
