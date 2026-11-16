import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listGoogleBrands, type GoogleBrand } from '@/lib/google-posts/brands';
import { createVersionsForNewContent } from '@/lib/google-posts/create';
import { GOOGLE_ALERT_CATEGORIES } from '@/lib/google-posts/model';
import { MAX_SEND_ATTEMPTS, sendDueVersions } from '@/lib/google-posts/send';

import {
  ACCESS_TOKEN,
  ACCOUNT,
  addCampaign,
  addImage,
  addPost,
  consoleText,
  createWorld,
  googleError,
  json,
  PARENT,
  type PostOptions,
  type World,
} from './world';

const CREATE_URL = `https://mybusiness.googleapis.com/v4/${PARENT}/localPosts`;
const POST_NAME = `${PARENT}/localPosts/abc123`;
const POST_TIME = '2026-11-16T12:00:00.000Z';

let world: World;

async function brand(): Promise<GoogleBrand> {
  const [found] = await listGoogleBrands(world.deps.db);
  return found;
}

/** A Facebook post due at 12:00 with its Google version, made at 10:00. */
async function prepare(options: PostOptions = {}): Promise<{ postId: string; versionId: string }> {
  const postId = addPost(world, { scheduledFor: POST_TIME, ...options });
  await createVersionsForNewContent(world.deps, await brand());
  const version = world.db.tables.gbp_posts.find((row) => row.content_item_id === postId);
  if (!version) throw new Error('no version was created');
  return { postId, versionId: String(version.id) };
}

function send(b?: GoogleBrand): Promise<ReturnType<typeof sendDueVersions> extends Promise<infer T> ? T : never> {
  return (async () => sendDueVersions(world.deps, b ?? (await brand()), { deadline: world.clock.now().getTime() + 50_000 }))();
}

const version = (versionId: string) => world.db.tables.gbp_posts.find((row) => row.id === versionId)!;
const post = (postId: string) => world.db.tables.content_items.find((row) => row.id === postId)!;
const creates = () => world.google.filter((request) => request.method === 'POST');
const alerts = () => world.db.rows('notifications');

function googleAccepts(): void {
  world.setGoogle(({ method }) =>
    method === 'POST' ? json({ name: POST_NAME, state: 'PROCESSING', searchUrl: 'https://local.google.com/post/abc123' }) : json({}),
  );
}

beforeEach(() => {
  world = createWorld();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('sending a due Google version', () => {
  it('sends after the Facebook post time with the cleaned wording and the feed image', async () => {
    const feed = addImage(world, { path: 'acc/quiz-feed.jpg' });
    const { versionId } = await prepare({ mediaIds: [feed] });
    googleAccepts();

    await send();
    expect(creates()).toEqual([]);

    world.clock.set('2026-11-16T12:01:00.000Z');
    const summary = await send();

    expect(summary.sent).toBe(1);
    expect(creates()).toHaveLength(1);
    expect(creates()[0]).toMatchObject({
      url: CREATE_URL,
      token: ACCESS_TOKEN,
      body: {
        languageCode: 'en-GB',
        topicType: 'STANDARD',
        summary: 'Quiz night this Thursday from 8pm. Teams of up to six.',
        media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://storage.example/media/acc/quiz-feed.jpg?token=signed-secret-token' }],
      },
    });
    expect(world.db.signed).toEqual([{ bucket: 'media', path: 'acc/quiz-feed.jpg', expiresIn: 3600 }]);
    expect(version(versionId)).toMatchObject({
      state: 'sent',
      google_post_name: POST_NAME,
      google_state: 'PROCESSING',
      search_url: 'https://local.google.com/post/abc123',
      sent_at: '2026-11-16T12:01:00.000Z',
      next_check_at: '2026-11-16T12:03:00.000Z',
      attempts: 1,
    });
  });

  it('uses the first image of the feed post only, never a story rendition or the date strip', async () => {
    const feed = addImage(world, { path: 'acc/feed.png', mime: 'image/png', derived: { story: 'acc/story.jpg', banner: 'acc/banner.jpg' } });
    const other = addImage(world, { path: 'acc/second.jpg' });
    await prepare({ mediaIds: [feed, other] });
    googleAccepts();
    world.clock.set('2026-11-16T12:01:00.000Z');

    await send();

    expect(world.db.signed.map((entry) => entry.path)).toEqual(['acc/feed.png']);
    expect(JSON.stringify(creates()[0].body)).not.toMatch(/story|banner/);
  });

  it.each([
    ['a video', { mediaType: 'video', mime: 'video/mp4', path: 'acc/clip.mp4' }],
    ['a file under 10 KB', { size: 2_000 }],
    ['a file over 5 MB', { size: 6 * 1024 * 1024 }],
    ['a GIF', { mime: 'image/gif', path: 'acc/a.gif' }],
  ])('sends the words without a picture when the image is %s', async (_label, image) => {
    const media = addImage(world, image);
    const { versionId } = await prepare({ mediaIds: [media] });
    googleAccepts();
    world.clock.set('2026-11-16T12:01:00.000Z');

    await send();

    expect(creates()[0].body).not.toHaveProperty('media');
    expect(version(versionId).state).toBe('sent');
  });

  it('tries again later when the image cannot be signed', async () => {
    const media = addImage(world);
    const { versionId } = await prepare({ mediaIds: [media] });
    world.db.signFails = true;
    world.clock.set('2026-11-16T12:01:00.000Z');

    await send();

    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'pending', attempts: 1, next_attempt_at: '2026-11-16T12:02:00.000Z' });
  });

  it('sends an EVENT with London times and a Book button', async () => {
    const campaignId = addCampaign(world, {
      metadata: {
        eventStart: '2026-11-16T19:00:00.000Z',
        eventEnd: '2026-11-16T22:00:00.000Z',
        eventTitle: 'Music Bingo',
        googleCtaUrl: 'https://l.example.com/bingo-g',
        takesBookings: true,
      },
    });
    await prepare({ campaignId });
    googleAccepts();
    world.clock.set('2026-11-16T12:01:00.000Z');

    await send();

    expect(creates()[0].body).toMatchObject({
      topicType: 'EVENT',
      callToAction: { actionType: 'BOOK', url: 'https://l.example.com/bingo-g' },
      event: {
        title: 'Music Bingo',
        schedule: {
          startDate: { year: 2026, month: 11, day: 16 },
          startTime: { hours: 19, minutes: 0, seconds: 0, nanos: 0 },
          endDate: { year: 2026, month: 11, day: 16 },
          endTime: { hours: 22, minutes: 0, seconds: 0, nanos: 0 },
        },
      },
    });
  });

  it('only one of two racing runs sends', async () => {
    const { versionId } = await prepare();
    googleAccepts();
    world.clock.set('2026-11-16T12:01:00.000Z');

    const b = await brand();
    const [one, two] = await Promise.all([send(b), send(b)]);

    expect(creates()).toHaveLength(1);
    expect(one.sent + two.sent).toBe(1);
    expect(version(versionId).state).toBe('sent');
  });

  it('a claim taken by another run between the checks and the claim is left alone', async () => {
    const { versionId } = await prepare();
    googleAccepts();
    world.clock.set('2026-11-16T12:01:00.000Z');
    world.db.beforeUpdate = (table) => {
      if (table !== 'gbp_posts') return;
      world.db.beforeUpdate = null;
      version(versionId).state = 'claimed';
      version(versionId).claimed_at = '2026-11-16T12:01:00.000Z';
    };

    await send();

    expect(creates()).toEqual([]);
    expect(version(versionId).state).toBe('claimed');
  });
});

describe('the Facebook post decides', () => {
  beforeEach(() => googleAccepts());

  it('waits when the Facebook post is moved later', async () => {
    const { postId, versionId } = await prepare();
    post(postId).scheduled_for = '2026-11-17T12:00:00.000Z';
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send();
    expect(creates()).toEqual([]);
    expect(version(versionId).state).toBe('pending');

    world.clock.set('2026-11-17T12:01:00.000Z');
    await send();
    expect(version(versionId).state).toBe('sent');
  });

  it.each([
    ['trashed', { deleted_at: '2026-11-16T11:00:00.000Z' }, 'parent_removed'],
    ['back to draft', { status: 'draft' }, 'parent_draft'],
  ])('skips when the Facebook post was %s', async (_label, change, reason) => {
    const { postId, versionId } = await prepare();
    Object.assign(post(postId), change);
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send();
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'skipped', hold_reason: reason });
  });

  it.each(['failed', 'posted', 'publishing'])('still sends when the Facebook post is %s (Google is independent)', async (status) => {
    const { postId, versionId } = await prepare();
    post(postId).status = status;
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send();
    expect(version(versionId).state).toBe('sent');
  });

  it('skips a version more than 24 hours late', async () => {
    const { versionId } = await prepare();
    world.clock.set('2026-11-17T12:30:00.000Z');
    await send();
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'skipped', hold_reason: 'too_late' });
  });

  it('skips an event that is already over', async () => {
    const campaignId = addCampaign(world, {
      metadata: { eventStart: '2026-11-16T19:00:00.000Z', eventEnd: '2026-11-16T22:00:00.000Z', eventTitle: 'Music Bingo' },
    });
    const { versionId } = await prepare({ campaignId });
    world.clock.set('2026-11-16T22:30:00.000Z');
    await send();
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'skipped', hold_reason: 'event_over' });
  });

  it('follows the Facebook wording until a person edits it, and holds it if it becomes an alcohol promotion', async () => {
    const { postId, versionId } = await prepare();
    world.db.tables.content_variants.find((row) => row.content_item_id === postId)!.body = '£3 pints all night for the quiz!';
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send();
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'held', hold_reason: 'alcohol_promotion' });
  });

  it('keeps wording a person edited', async () => {
    const { postId, versionId } = await prepare();
    Object.assign(version(versionId), { summary: 'Our own words for Google.', summary_edited_at: '2026-11-16T11:00:00.000Z' });
    world.db.tables.content_variants.find((row) => row.content_item_id === postId)!.body = 'Changed on Facebook.';
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send();
    expect(creates()[0].body).toMatchObject({ summary: 'Our own words for Google.' });
  });
});

describe('the brand and its connection, checked again at send time', () => {
  beforeEach(() => googleAccepts());

  it('skips when Google posting was switched off', async () => {
    const { versionId } = await prepare();
    const b = await brand();
    world.db.tables.accounts.find((row) => row.id === ACCOUNT)!.google_posts_enabled = false;
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send(b);
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'skipped', hold_reason: 'switched_off' });
  });

  it('fails without an alert when the connection is gone', async () => {
    const { versionId } = await prepare();
    const b = await brand();
    world.db.tables.social_connections[0].status = 'needs_action';
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send(b);
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'failed', hold_reason: 'connection_missing' });
    expect(alerts()).toEqual([]);
  });

  it('never sends to a different profile than the one the version was made for', async () => {
    const { versionId } = await prepare();
    const connection = world.db.tables.social_connections[0];
    connection.metadata = { ...(connection.metadata as object), localPostParent: 'accounts/222/locations/888' };
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send();
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'failed', hold_reason: 'destination_changed' });
    expect(alerts()).toEqual([expect.objectContaining({ category: GOOGLE_ALERT_CATEGORIES.failed, resource_id: versionId })]);
  });

  it('fails and asks for a reconnect when the token cannot be refreshed', async () => {
    const { versionId } = await prepare();
    world.token.mockResolvedValue({ ok: false, reason: 'reconnect_needed' });
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send();
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'failed', hold_reason: 'reconnect_needed' });
    expect(alerts()).toEqual([expect.objectContaining({ category: GOOGLE_ALERT_CATEGORIES.reconnect })]);
  });

  it('tries again later when the token is only temporarily unavailable', async () => {
    const { versionId } = await prepare();
    world.token.mockResolvedValueOnce({ ok: false, reason: 'try_again' });
    world.clock.set('2026-11-16T12:01:00.000Z');
    await send();
    expect(version(versionId)).toMatchObject({ state: 'pending', attempts: 1, next_attempt_at: '2026-11-16T12:02:00.000Z' });

    world.clock.set('2026-11-16T12:02:00.000Z');
    await send();
    expect(version(versionId).state).toBe('sent');
  });
});

describe("Google's answers", () => {
  async function due(): Promise<string> {
    const { versionId } = await prepare();
    world.clock.set('2026-11-16T12:01:00.000Z');
    return versionId;
  }

  it('fails a 400 with Google\'s sanitised words and one alert', async () => {
    const versionId = await due();
    world.setGoogle(() => googleError(400, 'Invalid summary near https://storage.example/media/a.jpg?token=signed-secret-token'));
    await send();
    expect(version(versionId)).toMatchObject({ state: 'failed', hold_reason: 'google_refused' });
    expect(String(version(versionId).last_error)).toContain('Invalid summary near [link]');
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({ category: 'google_post_failed', urgency: 'urgent', resource_type: 'gbp_post', resource_id: versionId });
  });

  it('refreshes the token once after a 401 and sends', async () => {
    const versionId = await due();
    let calls = 0;
    world.setGoogle(() => {
      calls += 1;
      return calls === 1 ? googleError(401, 'expired', 'UNAUTHENTICATED') : json({ name: POST_NAME, state: 'PROCESSING' });
    });
    await send();
    expect(world.token).toHaveBeenLastCalledWith(world.deps.db, ACCOUNT, { forceRefresh: true });
    expect(creates()).toHaveLength(2);
    expect(version(versionId).state).toBe('sent');
  });

  it('asks for a reconnect after a second 401', async () => {
    const versionId = await due();
    world.setGoogle(() => googleError(401, 'expired', 'UNAUTHENTICATED'));
    await send();
    expect(creates()).toHaveLength(2);
    expect(version(versionId)).toMatchObject({ state: 'failed', hold_reason: 'reconnect_needed' });
    expect(alerts()).toEqual([expect.objectContaining({ category: 'google_reconnect_needed' })]);
  });

  it.each([
    [403, 'not_permitted'],
    [404, 'profile_not_found'],
  ])('fails a %s without retrying', async (status, reason) => {
    const versionId = await due();
    world.setGoogle(() => googleError(status, 'nope', 'PERMISSION_DENIED'));
    await send();
    world.clock.advance(60 * 60 * 1000);
    await send();
    expect(creates()).toHaveLength(1);
    expect(version(versionId)).toMatchObject({ state: 'failed', hold_reason: reason });
    expect(alerts()).toHaveLength(1);
  });

  it('backs off after a 429 and sends once Google allows it', async () => {
    const versionId = await due();
    world.setGoogle(() => googleError(429, 'slow down', 'RESOURCE_EXHAUSTED'));
    await send();
    expect(version(versionId)).toMatchObject({ state: 'pending', attempts: 1, hold_reason: null, next_attempt_at: '2026-11-16T12:02:00.000Z' });

    world.clock.set('2026-11-16T12:01:30.000Z');
    await send();
    expect(creates()).toHaveLength(1);

    googleAccepts();
    world.clock.set('2026-11-16T12:02:00.000Z');
    await send();
    expect(version(versionId)).toMatchObject({ state: 'sent', attempts: 2 });
  });

  it(`gives up after ${MAX_SEND_ATTEMPTS} server errors, with one alert`, async () => {
    const versionId = await due();
    world.setGoogle(() => googleError(503, 'unavailable', 'UNAVAILABLE'));
    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS + 2; attempt += 1) {
      await send();
      world.clock.advance(31 * 60 * 1000);
    }
    expect(creates()).toHaveLength(MAX_SEND_ATTEMPTS);
    expect(version(versionId)).toMatchObject({ state: 'failed', hold_reason: 'still_failing', attempts: MAX_SEND_ATTEMPTS });
    expect(alerts()).toHaveLength(1);
  });

  it('treats a lost answer as uncertain and never sends it again blindly', async () => {
    const versionId = await due();
    world.setGoogle(() => {
      throw new Error('socket hang up');
    });
    const summary = await send();
    expect(summary.uncertain).toBe(1);
    expect(version(versionId)).toMatchObject({ state: 'uncertain', next_attempt_at: '2026-11-16T12:11:00.000Z' });

    world.clock.set('2026-11-16T12:05:00.000Z');
    await send();
    expect(creates()).toHaveLength(1);
  });

  it('keeps no token, signed link or post text in any log', async () => {
    const media = addImage(world);
    const { versionId } = await prepare({ mediaIds: [media], body: 'A very particular sentence about the quiz.' });
    world.clock.set('2026-11-16T12:01:00.000Z');
    world.setGoogle(() => googleError(400, 'Bad sourceUrl https://storage.example/media/acc/quiz.jpg?token=signed-secret-token'));
    world.db.fail('notifications', 'insert', 1);
    await send();
    expect(version(versionId).state).toBe('failed');
    const logged = consoleText();
    expect(logged).not.toContain(ACCESS_TOKEN);
    expect(logged).not.toContain('signed-secret-token');
    expect(logged).not.toContain('very particular sentence');
    expect(String(version(versionId).last_error)).not.toContain('signed-secret-token');
  });
});

describe('finding out what happened to an uncertain send', () => {
  async function uncertain(): Promise<string> {
    const { versionId } = await prepare();
    world.clock.set('2026-11-16T12:01:00.000Z');
    world.setGoogle(() => {
      throw new Error('socket hang up');
    });
    await send();
    expect(version(versionId).state).toBe('uncertain');
    return versionId;
  }

  const listed = (localPosts: unknown[]) => json({ localPosts });

  it('adopts the post when Google has it', async () => {
    const versionId = await uncertain();
    world.setGoogle(({ method }) =>
      method === 'GET'
        ? listed([
            { name: `${PARENT}/localPosts/old`, summary: 'Something else', createTime: '2026-11-10T10:00:00Z' },
            { name: POST_NAME, summary: 'Quiz night this Thursday from 8pm. Teams of up to six.', createTime: '2026-11-16T12:01:02Z', state: 'LIVE' },
          ])
        : json({}),
    );
    world.clock.set('2026-11-16T12:11:00.000Z');
    const summary = await send();
    expect(summary.adopted).toBe(1);
    expect(creates()).toHaveLength(1);
    expect(version(versionId)).toMatchObject({ state: 'sent', google_post_name: POST_NAME, google_state: 'LIVE' });
  });

  it('sends exactly once more when Google does not have it', async () => {
    const versionId = await uncertain();
    world.setGoogle(({ method }) => (method === 'GET' ? listed([]) : json({ name: POST_NAME, state: 'PROCESSING' })));
    world.clock.set('2026-11-16T12:11:00.000Z');
    await send();
    expect(creates()).toHaveLength(2);
    expect(version(versionId)).toMatchObject({ state: 'sent', resend_count: 1 });
  });

  it('raises one alert and stays uncertain when it is still unclear after the one re-send', async () => {
    const versionId = await uncertain();
    world.setGoogle(({ method }) => {
      if (method === 'GET') return listed([]);
      throw new Error('socket hang up');
    });
    world.clock.set('2026-11-16T12:11:00.000Z');
    await send();
    expect(version(versionId)).toMatchObject({ state: 'uncertain', resend_count: 1 });

    for (let check = 0; check < 3; check += 1) {
      world.clock.advance(61 * 60 * 1000);
      await send();
    }
    expect(creates()).toHaveLength(2);
    expect(version(versionId).state).toBe('uncertain');
    expect(alerts().filter((row) => row.category === 'google_post_unconfirmed')).toHaveLength(1);
  });

  it('treats a claim a crashed run left behind as uncertain, never re-sending it', async () => {
    const { versionId } = await prepare();
    Object.assign(version(versionId), { state: 'claimed', claimed_at: '2026-11-16T12:00:30.000Z', attempts: 1 });
    world.clock.set('2026-11-16T12:06:00.000Z');
    world.setGoogle(({ method }) => (method === 'GET' ? json({ localPosts: [] }) : json({ name: POST_NAME })));
    await send();
    expect(creates()).toEqual([]);
    expect(version(versionId)).toMatchObject({ state: 'uncertain', next_attempt_at: '2026-11-16T12:10:30.000Z' });

    // Ten minutes after the claim Google is asked; with nothing there, one more send is allowed.
    world.clock.set('2026-11-16T12:10:30.000Z');
    await send();
    expect(world.google.filter((request) => request.method === 'GET')).toHaveLength(1);
    expect(version(versionId)).toMatchObject({ state: 'sent', resend_count: 1 });
  });
});
