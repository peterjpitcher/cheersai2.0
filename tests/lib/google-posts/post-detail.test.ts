import { beforeEach, describe, expect, it, vi } from 'vitest';

const planner = vi.hoisted(() => ({ getPlannerContentDetail: vi.fn() }));
const settings = vi.hoisted(() => ({ getOwnerSettings: vi.fn() }));
const auth = vi.hoisted(() => ({ requireAuthContext: vi.fn() }));

vi.mock('@/lib/auth/server', () => ({ requireAuthContext: auth.requireAuthContext }));
vi.mock('@/lib/billing/entitlement-server', () => ({ requireEntitledContext: vi.fn(), EntitlementError: class EntitlementError extends Error {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/planner/data', () => ({ getPlannerContentDetail: planner.getPlannerContentDetail }));
vi.mock('@/lib/settings/data', () => ({ getOwnerSettings: settings.getOwnerSettings }));

import { loadGooglePostDetail } from '@/app/(app)/planner/google-version-actions';
import { readGooglePostDetail } from '@/lib/google-posts/post-detail';

import { ACCOUNT, addPost, createWorld, OTHER_ACCOUNT, PARENT, type World } from './world';

let world: World;

const ctx = (googlePosts = true, accountId = ACCOUNT) => ({ supabase: world.deps.db, accountId, features: { googlePosts } });

function addGooglePost(overrides: Record<string, unknown> = {}, account = ACCOUNT): { postId: string; googleId: string } {
  const postId = addPost(world, { account, scheduledFor: '2026-11-20T11:00:00.000Z' });
  world.db.seed('gbp_posts', [
    { account_id: account, content_item_id: postId, local_post_parent: PARENT, state: 'pending', summary: 'Quiz night.', ...overrides },
  ]);
  return { postId, googleId: String(world.db.tables.gbp_posts.find((row) => row.content_item_id === postId)!.id) };
}

function parentDetail(postId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: postId,
    platform: 'facebook',
    placement: 'feed',
    body: 'Quiz night this Thursday from 8pm. #quiz',
    scheduledFor: '2026-11-20T11:00:00.000Z',
    campaign: { id: 'c1', name: 'Quiz Night', campaignType: 'event', metadata: null },
    media: [
      { id: 'm0', url: 'https://example.com/clip.mp4', mediaType: 'video', fileName: null },
      { id: 'm1', url: 'https://example.com/quiz.jpg', mediaType: 'image', fileName: 'quiz.jpg' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  world = createWorld();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  settings.getOwnerSettings.mockResolvedValue({ posting: { timezone: 'Europe/London' } });
  auth.requireAuthContext.mockImplementation(async () => ({ ...ctx(), activeAccountId: ACCOUNT, brands: [], role: 'owner', isSuperAdmin: false }));
});

describe('one Google post, for its page and for the planner drawer', () => {
  it('gives the post, its picture, its time and its section', async () => {
    const { postId, googleId } = addGooglePost();
    planner.getPlannerContentDetail.mockResolvedValue(parentDetail(postId));

    const detail = await readGooglePostDetail(ctx(), googleId);

    expect(detail).toMatchObject({
      title: 'Quiz Night',
      // No time of its own: the Facebook post's.
      currentTime: '2026-11-20T11:00:00.000Z',
      // The first IMAGE, which is what Google is sent, not the first attachment.
      imageUrl: 'https://example.com/quiz.jpg',
      parentId: postId,
      timezone: 'Europe/London',
      timezoneLabel: 'Europe/London',
      version: { id: googleId, state: 'pending', ownTime: null },
      section: { kind: 'ready' },
    });
    expect(planner.getPlannerContentDetail).toHaveBeenCalledWith(postId);
  });

  it('prefers the Google post\'s own time, and an event title over the campaign name', async () => {
    const { postId, googleId } = addGooglePost({
      scheduled_for: '2026-11-21T09:30:00.000Z',
      topic_type: 'EVENT',
      event_title: 'Tinsel & Trivia',
      event_start: '2026-12-02T19:00:00.000Z',
      event_end: '2026-12-02T21:30:00.000Z',
    });
    planner.getPlannerContentDetail.mockResolvedValue(parentDetail(postId));
    expect(await readGooglePostDetail(ctx(), googleId)).toMatchObject({ title: 'Tinsel & Trivia', currentTime: '2026-11-21T09:30:00.000Z' });
  });

  it('still shows a Google post whose Facebook post has been removed, with no picture and no parent', async () => {
    const { googleId } = addGooglePost();
    planner.getPlannerContentDetail.mockResolvedValue(null);
    expect(await readGooglePostDetail(ctx(), googleId)).toMatchObject({
      title: 'Google post',
      currentTime: null,
      imageUrl: null,
      parentId: null,
      section: { kind: 'ready', version: { id: googleId } },
    });
  });

  it('gives nothing for another brand\'s post, an id that is not one, or a brand with the switch off, and reads nothing then', async () => {
    const mine = addGooglePost();
    const theirs = addGooglePost({}, OTHER_ACCOUNT);
    planner.getPlannerContentDetail.mockResolvedValue(parentDetail(mine.postId));

    expect(await readGooglePostDetail(ctx(), theirs.googleId)).toBeNull();
    expect(planner.getPlannerContentDetail).not.toHaveBeenCalled();

    world.db.queries.length = 0;
    expect(await readGooglePostDetail(ctx(), 'not-an-id')).toBeNull();
    expect(await readGooglePostDetail(ctx(false), mine.googleId)).toBeNull();
    expect(world.db.queries).toEqual([]);
  });
});

describe('the drawer\'s server action', () => {
  it('returns the detail for the active brand', async () => {
    const { postId, googleId } = addGooglePost();
    planner.getPlannerContentDetail.mockResolvedValue(parentDetail(postId));
    const result = await loadGooglePostDetail({ id: googleId });
    expect(result.error).toBeUndefined();
    expect(result.detail).toMatchObject({ parentId: postId, version: { id: googleId } });
  });

  it('refuses a malformed id before reading anything, and returns null for another brand\'s post', async () => {
    const theirs = addGooglePost({}, OTHER_ACCOUNT);
    world.db.queries.length = 0;
    expect(await loadGooglePostDetail({ id: 'nope' })).toEqual({ detail: null, error: 'That Google post could not be found.' });
    expect(auth.requireAuthContext).not.toHaveBeenCalled();
    expect(world.db.queries).toEqual([]);

    expect(await loadGooglePostDetail({ id: theirs.googleId })).toEqual({ detail: null });
  });

  it('answers with plain words, never the error, when the read fails', async () => {
    const { googleId } = addGooglePost();
    world.db.fail('gbp_posts', 'select', 1);
    const result = await loadGooglePostDetail({ id: googleId });
    expect(result).toEqual({ detail: null, error: 'We could not load this Google post. Please try again.' });
  });
});
