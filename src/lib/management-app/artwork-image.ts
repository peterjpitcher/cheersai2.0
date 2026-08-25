/**
 * Validating and re-rendering imported artwork.
 *
 * Two jobs. First, refuse anything that is not plainly an image we asked for:
 * the Content-Type header is written by the other end, so format is decided
 * from the bytes, and a decode is bounded before it starts. A 2 MB PNG can
 * legitimately decode to a very large surface, and an intentionally crafted one
 * can decode to an enormous one.
 *
 * Second, produce the four renditions CheersAI's publish path expects, matching
 * what the browser upload path already generates so an imported asset and an
 * uploaded one behave identically downstream.
 */

import sharp from "sharp";

export type ArtworkFormat = "jpeg" | "png" | "webp";

/** Guards the decode itself: roughly a 6000x6000 image, well past any artwork. */
const LIMIT_INPUT_PIXELS = 40_000_000;

/**
 * Below this, upscaling to 1080-wide renditions produces visible mush. Warn and
 * skip rather than publish something that looks broken.
 */
export const MIN_SOURCE_SHORT_EDGE = 540;
export const MAX_SOURCE_LONG_EDGE = 12_000;

const SHARP_LIMITS = {
  failOn: "error",
  limitInputPixels: LIMIT_INPUT_PIXELS,
  unlimited: false,
  // One frame only. An animated WebP or APNG has no place on a static post, and
  // decoding every frame multiplies the memory cost by the frame count.
  pages: 1,
  animated: false,
} as const;

export type ArtworkRendition = "feed" | "story" | "square" | "landscape";

/**
 * Target sizes.
 *
 * `square` is 1080x1350 rather than 1:1 on purpose: that is what
 * `client-derivatives.ts` produces for uploads, and the library preview logic
 * is built around it. `feed` is the true 1:1 that becomes storage_path.
 */
export const RENDITION_SIZES: Record<ArtworkRendition, { width: number; height: number }> = {
  feed: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1350 },
  landscape: { width: 1920, height: 1080 },
};

export type ArtworkImageRejection =
  | "unsupported_format"
  | "too_small"
  | "too_large"
  | "undecodable";

export class ArtworkImageError extends Error {
  readonly kind: ArtworkImageRejection;

  constructor(kind: ArtworkImageRejection, message: string) {
    super(message);
    this.name = "ArtworkImageError";
    this.kind = kind;
  }
}

/**
 * Identify the format from the leading bytes.
 *
 * Deliberately not from Content-Type: a hostile or misconfigured host can send
 * `image/png` with anything at all behind it, and Sharp will happily start
 * decoding whatever it is handed.
 */
export function sniffArtworkFormat(bytes: Uint8Array): ArtworkFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }

  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

export interface ValidatedArtworkSource {
  bytes: Uint8Array;
  format: ArtworkFormat;
  width: number;
  height: number;
  hasAlpha: boolean;
}

/** Sniff, decode the header, and bound the dimensions before any real work. */
export async function validateArtworkSource(bytes: Uint8Array): Promise<ValidatedArtworkSource> {
  const format = sniffArtworkFormat(bytes);
  if (!format) {
    throw new ArtworkImageError(
      "unsupported_format",
      "Artwork is not a JPEG, PNG or WebP.",
    );
  }

  let width: number | undefined;
  let height: number | undefined;
  let hasAlpha = false;

  try {
    const metadata = await sharp(Buffer.from(bytes), SHARP_LIMITS).metadata();
    // EXIF orientation 5 to 8 swap the axes, and metadata reports the stored
    // dimensions, not the displayed ones. Compare on the rotated values so a
    // portrait phone photo is not judged as landscape.
    const swap = typeof metadata.orientation === "number" && metadata.orientation >= 5;
    width = swap ? metadata.height : metadata.width;
    height = swap ? metadata.width : metadata.height;
    hasAlpha = Boolean(metadata.hasAlpha);
  } catch {
    throw new ArtworkImageError("undecodable", "Artwork could not be decoded.");
  }

  if (!width || !height) {
    throw new ArtworkImageError("undecodable", "Artwork has no readable dimensions.");
  }

  if (Math.max(width, height) > MAX_SOURCE_LONG_EDGE) {
    throw new ArtworkImageError("too_large", `Artwork is larger than ${MAX_SOURCE_LONG_EDGE}px.`);
  }

  if (Math.min(width, height) < MIN_SOURCE_SHORT_EDGE) {
    throw new ArtworkImageError(
      "too_small",
      `Artwork is smaller than ${MIN_SOURCE_SHORT_EDGE}px on its short edge.`,
    );
  }

  return { bytes, format, width, height, hasAlpha };
}

/**
 * Render one target size.
 *
 * Everything comes out as sRGB JPEG with no metadata:
 *  - Instagram's publishing API wants JPEG, and the existing browser path
 *    already produces JPEG, so an imported asset must not be the odd one out;
 *  - artwork is opaque, so flattening alpha onto white is a no-op in practice
 *    and stops a transparent PNG turning black on conversion;
 *  - 4:4:4 chroma because this artwork is text-heavy and 4:2:0 smears small
 *    type, which is exactly what an event poster is made of;
 *  - EXIF is honoured then dropped, so a rotated source is not published
 *    sideways by a viewer that ignores the tag.
 */
export async function renderArtworkRendition(
  source: ValidatedArtworkSource,
  rendition: ArtworkRendition,
): Promise<Buffer> {
  const { width, height } = RENDITION_SIZES[rendition];

  return sharp(Buffer.from(source.bytes), SHARP_LIMITS)
    .rotate()
    .resize(width, height, {
      fit: "cover",
      position: "centre",
      // Upscaling a small source is better than emitting a rendition at the
      // wrong size: the publish worker and Instagram both expect these exact
      // shapes, and `validateArtworkSource` has already refused anything
      // genuinely too small to carry.
      withoutEnlargement: false,
    })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: false })
    .toBuffer();
}
