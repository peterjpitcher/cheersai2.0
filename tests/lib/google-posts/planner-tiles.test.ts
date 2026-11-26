import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadGoogleTiles } from '@/lib/google-posts/planner-tiles';
import type { ContentItem } from '@/types/content';

import { ACCOUNT, addPost, createWorld, OTHER_ACCOUNT, PARENT, type World } from './world';

let world: World;

const START = '2026-11-16T00:00:00.000Z';
const END = '2026-12-27T23:59:59.999Z';

function calendarItem(id: string, scheduledFor: string, overrides: Partial<ContentItem> = {}): ContentItem {
  const when = new Date(scheduledFor);
  return {
    id,
    accountId: ACCOUNT,
    contentType: 'event',
    status: 'scheduled',
    title: 'Quiz Night',
    bodyDraft: null,
    campaignName: 'Quiz Night',
    scheduledAt: when,
    eventDate: null,
    eventEndDate: null,
    couponCode: null,
    recurringDayOfWeek: null,
    autoConfirm: false,
    aiGenerationParams: null,
    thumbnailUrl: null,
    placement: 'feed',
    platform: 'facebook',
    createdAt: when,
    updatedAt: when,
    ...overrides,
  };
}

function addGooglePost(postId: string, overrides: Record<string, unknown> = {}, account = ACCOUNT): string {
  world.db.seed('gbp_posts', [
    { account_id: account, content_item_id: postId, local_post_parent: PARENT, state: 'pending', summary: 'Quiz night.', ...overrides },
  ]);
  return String(world.db.tables.gbp_posts.find((row) => row.content_item_id === postId)!.id);
}

const ctx = (googlePosts = true) => ({ supabase: world.deps.db, accountId: ACCOUNT, features: { googlePosts } });

beforeEach(() => {
  world = createWorld();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Google tiles for the planner (D14)', () => {
  it('puts a Google post on its Facebook post\'s day with that post\'s picture', async () => {
    const postId = addPost(world, { scheduledFor: '2026-11-20T11:00:00.000Z' });
    const googleId = addGooglePost(postId);
    const tiles = await loadGoogleTiles(ctx(), {
      calendarItems: [calendarItem(postId, '2026-11-20T11:00:00.000Z')],
      startIso: START,
      endIso: END,
      thumbnails: new Map([[postId, 'https://example.com/quiz.jpg']]),
    });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      id: `google:${googleId}`,
      googlePostId: googleId,
      title: 'Quiz Night',
      status: 'scheduled',
      thumbnailUrl: 'https://example.com/quiz.jpg',
      platform: null,
    });
    expect(tiles[0].scheduledAt?.toISOString()).toBe('2026-11-20T11:00:00.000Z');
  });

  it('puts a moved Google post on its own day, fetching the picture when its Facebook post is outside the view', async () => {
    const inView = addPost(world, { scheduledFor: '2026-11-20T11:00:00.000Z' });
    addGooglePost(inView, { scheduled_for: '2027-02-01T10:00:00.000Z' });
    const outOfView = addPost(world, { scheduledFor: '2027-01-15T11:00:00.000Z' });
    const movedIn = addGooglePost(outOfView, { scheduled_for: '2026-11-25T09:30:00.000Z', event_title: 'Burns Night' });
    const resolveMissingThumbnails = vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `https://example.com/${id}.jpg`])));

    const tiles = await loadGoogleTiles(ctx(), {
      calendarItems: [calendarItem(inView, '2026-11-20T11:00:00.000Z')],
      startIso: START,
      endIso: END,
      thumbnails: new Map(),
      resolveMissingThumbnails,
    });

    // The one moved out of the view is not shown on its Facebook post's day.
    expect(tiles.map((tile) => tile.googlePostId)).toEqual([movedIn]);
    expect(tiles[0]).toMatchObject({ title: 'Burns Night', thumbnailUrl: `https://example.com/${outOfView}.jpg` });
    expect(tiles[0].scheduledAt?.toISOString()).toBe('2026-11-25T09:30:00.000Z');
    expect(resolveMissingThumbnails).toHaveBeenCalledWith([outOfView]);
  });

  it('shows no tile for a skipped Google post, a story, an Instagram post or another brand', async () => {
    const skipped = addPost(world, { scheduledFor: '2026-11-20T11:00:00.000Z' });
    addGooglePost(skipped, { state: 'skipped', hold_reason: 'skipped_by_person' });
    const otherBrand = addPost(world, { account: OTHER_ACCOUNT, scheduledFor: '2026-11-21T11:00:00.000Z' });
    addGooglePost(otherBrand, { scheduled_for: '2026-11-21T11:00:00.000Z' }, OTHER_ACCOUNT);

    const tiles = await loadGoogleTiles(ctx(), {
      calendarItems: [
        calendarItem(skipped, '2026-11-20T11:00:00.000Z'),
        calendarItem('story-1', '2026-11-20T11:00:00.000Z', { placement: 'story' }),
        calendarItem('ig-1', '2026-11-20T11:00:00.000Z', { platform: 'instagram' }),
      ],
      startIso: START,
      endIso: END,
      thumbnails: new Map(),
    });
    expect(tiles).toEqual([]);
    // Every Google read is scoped to the active brand.
    const unscoped = world.db.queries.filter(
      (query) => query.table === 'gbp_posts' && !query.eq.some(([column, value]) => column === 'account_id' && value === ACCOUNT),
    );
    expect(unscoped).toEqual([]);
  });

  it('reads nothing when the brand\'s Google switch is off, and shows the planner without tiles when the read fails', async () => {
    const postId = addPost(world, { scheduledFor: '2026-11-20T11:00:00.000Z' });
    addGooglePost(postId);
    const options = {
      calendarItems: [calendarItem(postId, '2026-11-20T11:00:00.000Z')],
      startIso: START,
      endIso: END,
      thumbnails: new Map<string, string>(),
    };

    const before = world.db.queries.length;
    expect(await loadGoogleTiles(ctx(false), options)).toEqual([]);
    expect(world.db.queries.length).toBe(before);

    const broken = { from: () => { throw new Error('database unavailable'); } };
    expect(await loadGoogleTiles({ supabase: broken as never, accountId: ACCOUNT, features: { googlePosts: true } }, options)).toEqual([]);
  });
});
