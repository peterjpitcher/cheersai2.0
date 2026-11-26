import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoogleWordingWriter } from '@/lib/google-posts/wording';

import { ACCOUNT, addPost, createWorld, PARENT, type World } from './world';

let world: World;
const writer = vi.fn<GoogleWordingWriter>();

vi.mock('@/lib/google-posts/deps', () => ({
  defaultGooglePostsDeps: vi.fn(async () => ({ ...world.deps, writeWording: writer })),
}));

const SECRET_SENTENCE = 'A very particular sentence about the quiz, which starts at 8pm for teams of up to six.';

beforeEach(() => {
  world = createWorld();
  writer.mockReset();
  writer.mockResolvedValue(SECRET_SENTENCE);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('GET /api/cron/google-wording', () => {
  const call = async (headers: Record<string, string> = {}) => {
    const { GET } = await import('@/app/api/cron/google-wording/route');
    return GET(new Request('https://cheers.example/api/cron/google-wording', { headers }));
  };

  function addWaiting(): string {
    const postId = addPost(world);
    world.db.seed('gbp_posts', [
      { account_id: ACCOUNT, content_item_id: postId, local_post_parent: PARENT, state: 'pending', summary: 'Derived.', wording_source: 'awaiting_ai' },
    ]);
    return postId;
  }

  it('refuses a request without the cron secret, before reading anything', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    addWaiting();
    world.db.queries.length = 0;
    expect((await call()).status).toBe(401);
    expect((await call({ Authorization: 'Bearer wrong' })).status).toBe(401);
    expect(world.db.queries).toEqual([]);
    expect(writer).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('writes the waiting wording and answers counts only, never the wording', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    const postId = addWaiting();
    const response = await call({ Authorization: 'Bearer test-cron-secret' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ brands: 1, written: 1, retried: 0, fellBack: 0, errors: 0 });
    expect(JSON.stringify(body)).not.toContain('particular sentence');
    expect(world.db.tables.gbp_posts.find((row) => row.content_item_id === postId)).toMatchObject({ wording_source: 'ai' });
    vi.unstubAllEnvs();
  });

  it('calls nothing when no post is waiting, and answers 500 when the read fails', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    expect((await call({ Authorization: 'Bearer test-cron-secret' })).status).toBe(200);
    expect(writer).not.toHaveBeenCalled();

    addWaiting();
    world.db.fail('gbp_posts', 'select', 1);
    expect((await call({ Authorization: 'Bearer test-cron-secret' })).status).toBe(500);
    vi.unstubAllEnvs();
  });
});
