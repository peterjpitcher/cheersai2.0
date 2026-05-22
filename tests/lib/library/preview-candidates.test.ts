import { describe, expect, it } from 'vitest';

import { resolvePreviewCandidates } from '@/lib/library/data';

describe('resolvePreviewCandidates', () => {
  const input = {
    storagePath: 'uploads/original.jpg',
    derivedVariants: {
      square: 'derived/media-1/square.jpg',
      story: 'derived/media-1/story.jpg',
      landscape: 'derived/media-1/landscape.jpg',
    },
  };

  it('preserves the existing square-first order when no placement is known', () => {
    const candidates = resolvePreviewCandidates(input);

    expect(candidates.map((candidate) => candidate.path)).toEqual([
      'derived/media-1/square.jpg',
      'derived/media-1/story.jpg',
      'derived/media-1/landscape.jpg',
      'uploads/original.jpg',
    ]);
  });

  it('prefers the story derivative for story placements', () => {
    const candidates = resolvePreviewCandidates({ ...input, placement: 'story' });

    expect(candidates[0]).toEqual({
      path: 'derived/media-1/story.jpg',
      shape: 'story',
    });
  });

  it('prefers the original asset for feed previews to avoid derivative crops', () => {
    const candidates = resolvePreviewCandidates({ ...input, placement: 'feed' });

    expect(candidates[0]).toEqual({
      path: 'uploads/original.jpg',
      shape: 'square',
    });
  });
});
