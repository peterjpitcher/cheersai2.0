// Image intake. The samples are generated with Sharp rather than committed as
// binaries, so the corpus is readable in the diff and cannot rot silently.

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  ArtworkImageError,
  MIN_SOURCE_SHORT_EDGE,
  RENDITION_SIZES,
  renderArtworkRendition,
  sniffArtworkFormat,
  validateArtworkSource,
} from "@/lib/management-app/artwork-image";

async function png(width: number, height: number, options?: { alpha?: boolean }): Promise<Uint8Array> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: options?.alpha ? 4 : 3,
      background: options?.alpha ? { r: 200, g: 0, b: 0, alpha: 0 } : { r: 200, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 90 } },
  })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buffer);
}

describe("sniffArtworkFormat", () => {
  it("identifies the three formats we accept from their leading bytes", async () => {
    expect(sniffArtworkFormat(await jpeg(600, 600))).toBe("jpeg");
    expect(sniffArtworkFormat(await png(600, 600))).toBe("png");

    const webp = new Uint8Array(
      await sharp({ create: { width: 600, height: 600, channels: 3, background: "#123456" } })
        .webp()
        .toBuffer(),
    );
    expect(sniffArtworkFormat(webp)).toBe("webp");
  });

  it("does not take the server's word for the format", async () => {
    // A hostile or misconfigured host can send `image/png` with anything behind
    // it, and Sharp will happily start decoding whatever it is handed.
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
    expect(sniffArtworkFormat(gif)).toBeNull();

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffArtworkFormat(svg)).toBeNull();

    expect(sniffArtworkFormat(new Uint8Array([0]))).toBeNull();
  });
});

describe("validateArtworkSource", () => {
  it("accepts ordinary designed artwork", async () => {
    const result = await validateArtworkSource(await png(1080, 1920));
    expect(result).toMatchObject({ format: "png", width: 1080, height: 1920 });
  });

  it("refuses a format we do not publish", async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    await expect(validateArtworkSource(gif)).rejects.toMatchObject({ kind: "unsupported_format" });
  });

  it("refuses an image too small to upscale without visible damage", async () => {
    const tiny = await png(MIN_SOURCE_SHORT_EDGE - 40, 900);
    await expect(validateArtworkSource(tiny)).rejects.toBeInstanceOf(ArtworkImageError);
    await expect(validateArtworkSource(tiny)).rejects.toMatchObject({ kind: "too_small" });
  });

  it("refuses an image with implausible dimensions", async () => {
    // A small compressed file can describe an enormous surface. This is the
    // decompression-bomb guard, checked from the header before any full decode.
    const huge = await png(20_000, 600);
    await expect(validateArtworkSource(huge)).rejects.toMatchObject({ kind: "too_large" });
  });

  it("refuses bytes that claim a format but will not decode", async () => {
    const corruptPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await expect(validateArtworkSource(corruptPng)).rejects.toMatchObject({ kind: "undecodable" });
  });

  it("judges dimensions after EXIF rotation, not before", async () => {
    // Orientation 6 means "rotate 90 on display", so a stored 600x1200 shows as
    // 1200x600. Judging the stored values would refuse a perfectly good image.
    const rotated = new Uint8Array(
      await sharp({ create: { width: 600, height: 1200, channels: 3, background: "#111111" } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );

    const result = await validateArtworkSource(rotated);
    expect(result.width).toBe(1200);
    expect(result.height).toBe(600);
  });

  it("reports an alpha channel so the caller knows flattening will do something", async () => {
    const transparent = await validateArtworkSource(await png(1080, 1080, { alpha: true }));
    expect(transparent.hasAlpha).toBe(true);
  });
});

describe("renderArtworkRendition", () => {
  it("produces exactly the size the publish path expects, as JPEG", async () => {
    const source = await validateArtworkSource(await png(1080, 1080));

    for (const rendition of ["feed", "story", "square", "landscape"] as const) {
      const output = await renderArtworkRendition(source, rendition);
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe("jpeg");
      expect(meta.width).toBe(RENDITION_SIZES[rendition].width);
      expect(meta.height).toBe(RENDITION_SIZES[rendition].height);
    }
  });

  it("flattens transparency to white rather than to black", async () => {
    // A transparent PNG converted to JPEG without flattening comes out black,
    // which on a social post reads as a broken image.
    const source = await validateArtworkSource(await png(1080, 1080, { alpha: true }));
    const output = await renderArtworkRendition(source, "feed");

    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeGreaterThan(240);
    expect(data[2]).toBeGreaterThan(240);
  });

  it("strips metadata from the output", async () => {
    const withExif = new Uint8Array(
      await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#334455" } })
        .withMetadata({ orientation: 3 })
        .jpeg()
        .toBuffer(),
    );

    const source = await validateArtworkSource(withExif);
    const output = await renderArtworkRendition(source, "feed");
    const meta = await sharp(output).metadata();

    // Orientation must be gone, not merely honoured: a viewer that reads the tag
    // would otherwise rotate an image that has already been rotated.
    expect(meta.orientation).toBeUndefined();
  });

  it("upscales a legitimately small source rather than emitting the wrong size", async () => {
    // The worker and Instagram both expect these exact shapes. A short rendition
    // is worse than a slightly soft one.
    const source = await validateArtworkSource(await png(MIN_SOURCE_SHORT_EDGE, MIN_SOURCE_SHORT_EDGE));
    const output = await renderArtworkRendition(source, "story");
    const meta = await sharp(output).metadata();

    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });
});
