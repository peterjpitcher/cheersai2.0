/**
 * The QStash publish failure callback emails the owner. The email explains the
 * failure in plain words and never quotes Meta's own text or the error code
 * (tasks/SPEC-plain-publish-failures.md).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/qstash/client', () => ({ verifyQStashSignature: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/env', () => ({ env: { client: { NEXT_PUBLIC_SITE_URL: 'https://app.test' } } }));

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { sendEmail } from '@/lib/email/resend';
import { POST } from './route';

const JOB_ID = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';
const CONTENT_ITEM_ID = '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918';
const ACCOUNT_ID = '6f1b1c1e-8c2a-4c47-9a53-1f2e3d4c5b6a';

type JobFixture = {
  platform: string;
  placement: string | null;
  error_message: string | null;
  last_error: string | null;
  error_code: string | null;
};

const inserted: Array<Record<string, unknown>> = [];

function mockDb(job: JobFixture) {
  const results: Record<string, { data: unknown; error: unknown }> = {
    publish_jobs: { data: { id: JOB_ID, content_item_id: CONTENT_ITEM_ID, ...job }, error: null },
    content_items: { data: { account_id: ACCOUNT_ID }, error: null },
    posting_defaults: { data: { notifications: { emailFailures: true } }, error: null },
    notifications: { data: null, error: null },
    accounts: { data: { email: 'owner@venue.test', display_name: 'The Anchor & Co' }, error: null },
  };
  return {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'filter']) chain[method] = vi.fn(() => chain);
      chain.single = vi.fn().mockResolvedValue(results[table]);
      chain.maybeSingle = vi.fn().mockResolvedValue(results[table]);
      chain.insert = vi.fn((row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ error: null });
      });
      return chain;
    }),
  };
}

function request(): Request {
  return new Request('https://app.test/api/webhooks/qstash-publish/failure', {
    method: 'POST',
    body: JSON.stringify({ jobId: JOB_ID }),
  });
}

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue(undefined);
  inserted.length = 0;
});

const FIXTURES: Array<{ name: string; job: JobFixture; plain: string; hidden: string[] }> = [
  {
    name: 'Instagram rate limit with its classification',
    job: {
      platform: 'instagram',
      placement: 'feed',
      error_message: '[instagram_create_container] status=400 OAuthException: (#4) Application request limit reached (code 4) trace=AbC123',
      last_error: null,
      error_code: 'rate_limit',
    },
    plain: 'Instagram is limiting how often we can post for you just now.',
    hidden: ['OAuthException', 'request limit reached', 'code 4', 'rate_limit', 'Error details'],
  },
  {
    name: 'Facebook permissions',
    job: {
      platform: 'facebook',
      placement: 'feed',
      error_message: '[facebook_feed_publish] status=403 OAuthException: (#200) Requires pages_manage_posts permission (code 200) trace=AbC123',
      last_error: null,
      error_code: 'auth',
    },
    plain: 'Cheers does not have permission to post to your Facebook Page.',
    hidden: ['pages_manage_posts', 'OAuthException', 'auth', 'Error details'],
  },
  {
    name: 'unknown text',
    job: {
      platform: 'facebook',
      placement: 'story',
      error_message: 'Meta Graph API error: 400',
      last_error: null,
      error_code: 'content_rejected',
    },
    plain: 'Facebook did not accept this post. We will look into it; you can try again or contact Cheers support.',
    hidden: ['Meta Graph API', 'content_rejected', 'Error details'],
  },
];

describe('QStash publish failure email', () => {
  it.each(FIXTURES)('$name', async ({ job, plain, hidden }) => {
    vi.mocked(createServiceSupabaseClient).mockReturnValue(mockDb(job) as never);

    const res = await POST(request());

    expect(await res.json()).toEqual({ sent: true });
    expect(sendEmail).toHaveBeenCalledOnce();
    const { html, subject, to } = vi.mocked(sendEmail).mock.calls[0][0];
    expect(to).toBe('owner@venue.test');
    expect(html).toContain(plain);
    expect(html).toContain('Hi The Anchor &amp; Co,');
    expect(html).not.toContain(job.error_message ?? '');
    for (const fragment of hidden) {
      expect(html).not.toContain(fragment);
    }
    // A template that renders these has reached customers before.
    for (const rendered of [html, subject]) {
      expect(rendered).not.toMatch(/undefined|Invalid Date|NaN|\bnull\b/);
    }
    expect(inserted).toEqual([expect.objectContaining({ category: 'publish_failed_immediate', metadata: { job_id: JOB_ID } })]);
  });

  it('sends no failure paragraph when nothing was stored', async () => {
    vi.mocked(createServiceSupabaseClient).mockReturnValue(
      mockDb({ platform: 'instagram', placement: 'feed', error_message: null, last_error: null, error_code: null }) as never,
    );

    await POST(request());

    const { html } = vi.mocked(sendEmail).mock.calls[0][0];
    expect(html).toContain('We were unable to publish your post to <strong>Instagram</strong> after multiple attempts.');
    expect(html).not.toMatch(/undefined|Invalid Date|NaN|\bnull\b/);
  });
});
