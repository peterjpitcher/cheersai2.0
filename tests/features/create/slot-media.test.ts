import { describe, expect, it } from 'vitest';

import { REUSE_TAG, defaultSlotMedia } from '@/features/create/steps/slot-media';
import type { MediaAssetSummary } from '@/lib/library/data';

function asset(id: string, tags: string[], overrides: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return {
    id,
    fileName: `${id}.jpg`,
    mediaType: 'image',
    tags,
    uploadedAt: '2026-10-01T10:00:00Z',
    storagePath: `media/${id}.jpg`,
    processedStatus: 'ready',
    derivedVariants: { story: `derived/${id}/story.jpg` },
    aspectClass: 'square',
    previewShape: 'square',
    ...overrides,
  };
}

const LIBRARY = [
  asset('burger', [REUSE_TAG, 'burger', 'pub food']),
  asset('bar', [REUSE_TAG, 'bar', 'pints']),
  asset('quiz', [REUSE_TAG, 'quiz night', 'crowd']),
  asset('nikki', [REUSE_TAG, 'Nikki on stage', 'music bingo']),
  asset('untagged-food', ['pizza', 'food']),
  asset('artwork', ['event-artwork', 'sleigh-my-name-festive-music-bingo']),
];

describe('defaultSlotMedia', () => {
  it('keeps the artwork for the announcement and the day, and varies the posts between', () => {
    const picks = defaultSlotMedia(['announce', 'how_it_works', 'eat_first', 'last_call', 'tonight'], LIBRARY);
    expect(picks).toEqual([undefined, ['bar'], ['burger'], ['quiz'], undefined]);
  });

  it('shows the host on "meet the host" when a reuse photo names them', () => {
    expect(defaultSlotMedia(['meet_the_host'], LIBRARY, { host: 'Nikki Manfadge' })).toEqual([['nikki']]);
  });

  it('falls back to a venue or event photo for the host when none names them', () => {
    expect(defaultSlotMedia(['meet_the_host'], LIBRARY, { host: 'Peter Pitcher' })).toEqual([['bar']]);
  });

  it('never uses a photo twice, then keeps the artwork', () => {
    const picks = defaultSlotMedia(['eat_first', 'eat_first'], LIBRARY);
    expect(picks).toEqual([['burger'], undefined]);
  });

  it('only ever picks photos tagged reuse', () => {
    const picks = defaultSlotMedia(['eat_first', 'how_it_works'], [LIBRARY[4], LIBRARY[5]]);
    expect(picks).toEqual([undefined, undefined]);
  });

  it('changes nothing when the library has no reuse photos', () => {
    expect(defaultSlotMedia(['announce', 'how_it_works', 'tonight'], [])).toEqual([undefined, undefined, undefined]);
  });

  it('leaves out videos and photos without an upright story version', () => {
    const library = [
      asset('video', [REUSE_TAG, 'bar'], { mediaType: 'video' }),
      asset('no-story', [REUSE_TAG, 'bar'], { derivedVariants: {} }),
    ];
    expect(defaultSlotMedia(['how_it_works'], library)).toEqual([undefined]);
  });

  it('reads the reuse tag without regard to case or spaces', () => {
    expect(defaultSlotMedia(['how_it_works'], [asset('bar-2', [' Reuse ', 'bar'])])).toEqual([['bar-2']]);
  });

  it('does not put a food photo on a post that is not about food', () => {
    expect(defaultSlotMedia(['how_it_works'], [LIBRARY[0]])).toEqual([undefined]);
  });
});
