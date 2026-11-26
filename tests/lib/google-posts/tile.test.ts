import { describe, expect, it } from 'vitest';

import {
  googlePostHrefForTile,
  googlePostIdForTile,
  googleStateToContentStatus,
  googleTileId,
  isGoogleTile,
  placeGoogleTiles,
  toGoogleTile,
} from '@/lib/google-posts/tile';

const GOOGLE_ID = '5b0d2d0e-3a1c-4c58-9f0a-2f6a3a0f3c11';

describe('Google planner tiles', () => {
  it('builds a tile that can never be mistaken for a content item', () => {
    const when = new Date('2026-12-03T11:00:00.000Z');
    const tile = toGoogleTile({
      id: GOOGLE_ID,
      accountId: 'acc-1',
      state: 'pending',
      when,
      title: 'Christmas Jackpot Cash Bingo',
      campaignName: 'Cash Bingo',
      thumbnailUrl: 'https://example.com/signed.jpg',
    });
    expect(tile).toMatchObject({
      id: `google:${GOOGLE_ID}`,
      googlePostId: GOOGLE_ID,
      status: 'scheduled',
      title: 'Christmas Jackpot Cash Bingo',
      scheduledAt: when,
      thumbnailUrl: 'https://example.com/signed.jpg',
      // Never a content platform: the Platform type stays Facebook and Instagram only.
      platform: null,
      placement: 'feed',
    });
    expect(isGoogleTile(tile)).toBe(true);
    expect(isGoogleTile({ id: 'post-1', platform: 'facebook' })).toBe(false);
    expect(isGoogleTile(null)).toBe(false);
  });

  it('opens the Google post page for a Google tile and nothing for a content item', () => {
    expect(googlePostHrefForTile(googleTileId(GOOGLE_ID))).toBe(`/planner/google/${GOOGLE_ID}`);
    expect(googlePostHrefForTile(GOOGLE_ID)).toBeNull();
    expect(googlePostHrefForTile('post-1')).toBeNull();
    // The drawer is opened with the Google post's own id.
    expect(googlePostIdForTile(googleTileId(GOOGLE_ID))).toBe(GOOGLE_ID);
    expect(googlePostIdForTile(GOOGLE_ID)).toBeNull();
    expect(googlePostIdForTile('google:')).toBeNull();
  });

  it.each([
    ['pending', 'scheduled'],
    ['held', 'review'],
    ['claimed', 'publishing'],
    ['uncertain', 'publishing'],
    ['sent', 'published'],
    ['failed', 'failed'],
    ['something-new', 'scheduled'],
  ])('shows a %s Google post as %s', (state, status) => {
    expect(googleStateToContentStatus(state)).toBe(status);
  });

  it('sits each Google tile straight after its Facebook feed post, and leaves everything else in order', () => {
    const at = (iso: string) => new Date(iso);
    const post = (id: string, platform: string, placement: string, iso: string) => ({ id, platform, placement, scheduledAt: at(iso) });
    const google = (id: string, iso: string) =>
      toGoogleTile({ id, accountId: 'acc-1', state: 'pending', when: at(iso), title: null, campaignName: null, thumbnailUrl: null });

    const fbFeed = post('fb-feed', 'facebook', 'feed', '2026-11-27T11:00:00.000Z');
    const igFeed = post('ig-feed', 'instagram', 'feed', '2026-11-27T11:00:00.000Z');
    const fbStory = post('fb-story', 'facebook', 'story', '2026-11-27T11:00:00.000Z');
    const igStory = post('ig-story', 'instagram', 'story', '2026-11-27T11:00:00.000Z');
    const paired = google('g-1', '2026-11-27T11:00:00.000Z');
    const moved = google('g-2', '2026-11-28T09:00:00.000Z');

    const placed = placeGoogleTiles<{ id: string }>([fbFeed, igFeed, fbStory, igStory, paired, moved]);
    expect(placed.map((item) => item.id)).toEqual(['fb-feed', 'google:g-1', 'ig-feed', 'fb-story', 'ig-story', 'google:g-2']);

    // Nothing Google: the same array back, untouched.
    const plain = [fbFeed, igFeed];
    expect(placeGoogleTiles(plain)).toBe(plain);
  });
});
