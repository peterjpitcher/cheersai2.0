import { describe, expect, it } from 'vitest';

import {
  googlePostHrefForTile,
  googleStateToContentStatus,
  googleTileId,
  isGoogleTile,
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
});
