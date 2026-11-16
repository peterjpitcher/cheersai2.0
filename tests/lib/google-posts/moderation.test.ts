import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listGoogleBrands, type GoogleBrand } from '@/lib/google-posts/brands';
import { checkSentVersions, nextCheckAt } from '@/lib/google-posts/moderation';

import { ACCOUNT, addPost, createWorld, googleError, json, PARENT, type World } from './world';

const NAME = `${PARENT}/localPosts/abc123`;
const SENT_AT = '2026-11-16T12:00:00.000Z';

let world: World;
let brand: GoogleBrand;

function addSent(overrides: Record<string, unknown> = {}): string {
  const postId = addPost(world, { scheduledFor: SENT_AT });
  const row = {
    account_id: ACCOUNT,
    content_item_id: postId,
    local_post_parent: PARENT,
    state: 'sent',
    topic_type: 'STANDARD',
    summary: 'Quiz night.',
    google_post_name: NAME,
    google_state: 'PROCESSING',
    sent_at: SENT_AT,
    claimed_at: '2026-11-16T11:59:59.000Z',
    attempts: 1,
    next_check_at: '2026-11-16T12:02:00.000Z',
    ...overrides,
  };
  world.db.seed('gbp_posts', [row]);
  return String(world.db.tables.gbp_posts.at(-1)!.id);
}

const version = (versionId: string) => world.db.tables.gbp_posts.find((row) => row.id === versionId)!;
const check = () => checkSentVersions(world.deps, brand, { deadline: world.clock.now().getTime() + 50_000 });
const alerts = (category: string) => world.db.rows('notifications').filter((row) => row.category === category);
const reads = () => world.google.filter((request) => request.method === 'GET');

beforeEach(async () => {
  world = createWorld({ start: '2026-11-16T12:00:00.000Z' });
  [brand] = await listGoogleBrands(world.deps.db);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('nextCheckAt', () => {
  it('reads at 2, 10 and 30 minutes, then hourly to a day, then daily', () => {
    const at = (minutes: number) => nextCheckAt({ sent_at: SENT_AT, topic_type: 'STANDARD', event_end: null }, Date.parse(SENT_AT) + minutes * 60_000);
    expect(at(0)).toBe('2026-11-16T12:02:00.000Z');
    expect(at(2)).toBe('2026-11-16T12:10:00.000Z');
    expect(at(10)).toBe('2026-11-16T12:30:00.000Z');
    expect(at(30)).toBe('2026-11-16T13:00:00.000Z');
    expect(at(23 * 60 + 5)).toBe('2026-11-17T12:00:00.000Z');
    expect(at(24 * 60)).toBe('2026-11-18T12:00:00.000Z');
    expect(at(6 * 24 * 60 + 1)).toBeNull();
  });

  it('stops watching an event once it has ended', () => {
    const row = { sent_at: SENT_AT, topic_type: 'EVENT' as const, event_end: '2026-11-17T22:00:00.000Z' };
    expect(nextCheckAt(row, Date.parse('2026-11-17T12:30:00.000Z'))).toBeNull();
  });
});

describe('checking what Google did with a sent post', () => {
  it('reads at the planned times and stops once Google shows the post', async () => {
    const versionId = addSent();
    world.setGoogle(() => json({ name: NAME, state: 'PROCESSING' }));

    await check();
    expect(reads()).toEqual([]);

    world.clock.set('2026-11-16T12:02:00.000Z');
    await check();
    expect(reads()).toHaveLength(1);
    expect(reads()[0].url).toBe(`https://mybusiness.googleapis.com/v4/${NAME}`);
    expect(version(versionId)).toMatchObject({ google_state: 'PROCESSING', next_check_at: '2026-11-16T12:10:00.000Z', check_attempts: 1 });

    world.setGoogle(() => json({ name: NAME, state: 'LIVE', searchUrl: 'https://local.google.com/post/abc123' }));
    world.clock.set('2026-11-16T12:10:00.000Z');
    await check();
    expect(version(versionId)).toMatchObject({ google_state: 'LIVE', next_check_at: null, search_url: 'https://local.google.com/post/abc123' });

    world.clock.set('2026-11-16T14:00:00.000Z');
    await check();
    expect(reads()).toHaveLength(2);
    expect(alerts('google_post_rejected')).toEqual([]);
  });

  it.each([
    ['straight away', '2026-11-16T12:02:00.000Z'],
    ['after it was shown', '2026-11-16T20:00:00.000Z'],
  ])('raises one alert when Google rejects it %s', async (_label, when) => {
    const versionId = addSent({ next_check_at: when });
    world.setGoogle(() => json({ name: NAME, state: 'REJECTED' }));
    world.clock.set(when);
    await check();
    await check();
    expect(version(versionId)).toMatchObject({ google_state: 'REJECTED', next_check_at: null, state: 'sent' });
    expect(alerts('google_post_rejected')).toHaveLength(1);
    expect(alerts('google_post_rejected')[0]).toMatchObject({ urgency: 'urgent', resource_id: versionId });
  });

  it('raises one alert when a post is still processing after a day, and keeps reading daily', async () => {
    const versionId = addSent({ next_check_at: '2026-11-17T12:00:00.000Z' });
    world.setGoogle(() => json({ name: NAME, state: 'PROCESSING' }));
    world.clock.set('2026-11-17T12:00:00.000Z');
    await check();
    expect(version(versionId).next_check_at).toBe('2026-11-18T12:00:00.000Z');
    world.clock.set('2026-11-18T12:00:00.000Z');
    await check();
    expect(alerts('google_post_processing')).toHaveLength(1);
  });

  it('stops watching a post removed on Google', async () => {
    const versionId = addSent();
    world.setGoogle(() => googleError(404, 'not found', 'NOT_FOUND'));
    world.clock.set('2026-11-16T12:02:00.000Z');
    await check();
    expect(version(versionId)).toMatchObject({ state: 'sent', next_check_at: null });
    expect(world.db.rows('notifications')).toEqual([]);
  });

  it('keeps trying through a read outage and raises one alert after six hours', async () => {
    const versionId = addSent();
    world.setGoogle(() => googleError(503, 'unavailable', 'UNAVAILABLE'));
    world.clock.set('2026-11-16T12:02:00.000Z');
    await check();
    expect(version(versionId).next_check_at).toBe('2026-11-16T12:12:00.000Z');
    expect(alerts('google_post_unconfirmed')).toEqual([]);

    for (let hour = 0; hour < 9; hour += 1) {
      world.clock.set(String(version(versionId).next_check_at));
      await check();
    }
    expect(version(versionId).state).toBe('sent');
    expect(version(versionId).next_check_at).not.toBeNull();
    expect(alerts('google_post_unconfirmed')).toHaveLength(1);
  });

  it('stops retrying a failed read once the watch period is over', async () => {
    const versionId = addSent({ next_check_at: '2026-11-23T11:00:00.000Z' });
    world.setGoogle(() => googleError(503, 'unavailable', 'UNAVAILABLE'));
    world.clock.set('2026-11-23T11:00:00.000Z');
    await check();
    expect(version(versionId).next_check_at).toBeNull();
  });
});
