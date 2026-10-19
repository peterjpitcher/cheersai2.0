import { describe, expect, it } from 'vitest';

import { storyLayout } from '@/lib/media/story-layout';

describe('storyLayout', () => {
  it('shows a square image whole, centred in the story frame', () => {
    expect(storyLayout(1080, 1080)).toEqual({ mode: 'fit', x: 0, y: 420, width: 1080, height: 1080 });
  });

  it('shows wide and 4:5 images whole too', () => {
    expect(storyLayout(1920, 1080)).toEqual({ mode: 'fit', x: 0, y: 656, width: 1080, height: 608 });
    expect(storyLayout(1080, 1350)).toEqual({ mode: 'fit', x: 0, y: 285, width: 1080, height: 1350 });
    expect(storyLayout(1000, 1500)).toEqual({ mode: 'fit', x: 0, y: 150, width: 1080, height: 1620 });
  });

  it('lets a story-shaped image fill the frame, losing a few pixels at most', () => {
    expect(storyLayout(1080, 1920)).toEqual({ mode: 'fill', x: 0, y: 0, width: 1080, height: 1920 });
    const nearly = storyLayout(1080, 1880);
    expect(nearly.mode).toBe('fill');
    expect(nearly.height).toBe(1920);
    expect(Math.abs(nearly.x)).toBeLessThanOrEqual(12);
  });
});
