// src/lib/banner/palette.ts
//
// Shared, app-side palette for the proximity banner. The DB CHECK constraints
// still validate hex format, so the palette is enforced UI-side: forms expose
// two preset swatches (Bronze and Green) instead of an arbitrary colour
// picker, but persisted values are the same hex strings the renderer reads.
//
// Also owns BANNER_LABEL_REPEAT_COUNT, the number of times the proximity
// label is repeated (separated by middle dots) so it visibly spills over both
// edges of the banner strip on any reasonable canvas. The same constant is
// used by the React overlay and the server-side Sharp/SVG renderer to keep
// the preview and the published image in lockstep.

export type BannerPaletteId = 'bronze' | 'green';

export const BANNER_PALETTES: Record<
  BannerPaletteId,
  { bg: string; text: string; label: string }
> = {
  bronze: { bg: '#a57626', text: '#FFFFFF', label: 'Bronze' },
  green: { bg: '#005131', text: '#FFFFFF', label: 'Green' },
};

export function paletteFromColours(bg: string, text: string): BannerPaletteId {
  void text;
  if (bg.toLowerCase() === BANNER_PALETTES.green.bg.toLowerCase()) return 'green';
  return 'bronze';
}

// Repeat the label this many times (joined by ' · ') so the rendered string
// overflows the strip on any reasonable size. 21 = 10 + label + 10 — large
// enough that even a 1920px-tall story strip is fully covered after rotation,
// and the strip's overflow:hidden / SVG viewport handle symmetric clipping.
export const BANNER_LABEL_REPEAT_COUNT = 21;

export const BANNER_LABEL_SEPARATOR = ' · ';

/**
 * The strip's text. An event story's booking prompt ("LINK IN BIO TO BOOK")
 * alternates with the label, with a prompt in the middle: the strip is centred,
 * so one whole prompt always sits mid-height, clear of the UI Instagram and
 * Facebook draw over the top and bottom of a story. Carrying the prompt in the
 * strip covers nothing more of the artwork (tasks/SPEC-story-booking-prompt.md).
 */
export function buildRepeatedBannerLabel(label: string, storyPrompt?: string | null): string {
  const prompt = storyPrompt?.trim();
  const middle = Math.floor(BANNER_LABEL_REPEAT_COUNT / 2);
  return Array.from({ length: BANNER_LABEL_REPEAT_COUNT }, (_, index) =>
    prompt && index % 2 === middle % 2 ? prompt : label,
  ).join(BANNER_LABEL_SEPARATOR);
}
