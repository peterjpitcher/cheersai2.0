/**
 * How a story version (1080x1920) shows an image. Decided by the owner on 20
 * October 2026 (tasks/SPEC-story-version-whole-image.md): the whole image,
 * centred over a blurred, darkened copy of itself, unless the image is already
 * story-shaped, when it simply fills the frame. Cropping the middle of a square
 * graphic had cut its words ("ate Hire Booki" for "Private Hire Bookings").
 *
 * Pure, so the browser upload path and the server-side artwork import share
 * one rule.
 */

export const STORY_SIZE = { width: 1080, height: 1920 } as const;

/** An image within 3% of the frame's shape fills it; the crop is then a few pixels at most. */
const FILL_TOLERANCE = 0.03;

export interface StoryLayout {
  /** fill: the image covers the frame. fit: the whole image sits over a blurred copy of itself. */
  mode: 'fill' | 'fit';
  /** Where the sharp image is drawn in the frame, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function storyLayout(
  imageWidth: number,
  imageHeight: number,
  frame: { width: number; height: number } = STORY_SIZE,
): StoryLayout {
  const ratio = imageWidth / imageHeight;
  const frameRatio = frame.width / frame.height;
  const mode = Math.abs(ratio - frameRatio) / frameRatio <= FILL_TOLERANCE ? 'fill' : 'fit';
  const scale = mode === 'fill'
    ? Math.max(frame.width / imageWidth, frame.height / imageHeight)
    : Math.min(frame.width / imageWidth, frame.height / imageHeight);
  const width = Math.round(imageWidth * scale);
  const height = Math.round(imageHeight * scale);
  return {
    mode,
    x: Math.round((frame.width - width) / 2),
    y: Math.round((frame.height - height) / 2),
    width,
    height,
  };
}
