// src/lib/banner/render-server.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import { buildBannerSvg, renderBannerServer } from '@/lib/banner/render-server';
import type { ResolvedConfig } from '@/lib/banner/config';

const config: ResolvedConfig = {
  enabled: true,
  position: 'bottom',
  bgColour: '#000000',
  textColour: '#FFFFFF',
  textOverride: null,
};

const rightStripConfig: ResolvedConfig = {
  enabled: true,
  position: 'right',
  bgColour: '#a57626',
  textColour: '#FFFFFF',
  textOverride: null,
};

describe('renderBannerServer', () => {
  it('produces a valid JPEG with same dimensions as the source for square 1080', async () => {
    const src = readFileSync('tests/fixtures/banner/square-1080.jpg');
    const out = await renderBannerServer(src, config, 'THIS WEDNESDAY');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
  });

  it('produces a JPEG for 4:5 portrait', async () => {
    const src = readFileSync('tests/fixtures/banner/portrait-1080-1350.jpg');
    const out = await renderBannerServer(src, config, 'TONIGHT');
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
  });

  it('produces a JPEG for 9:16 story', async () => {
    const src = readFileSync('tests/fixtures/banner/story-1080-1920.jpg');
    const out = await renderBannerServer(src, config, 'TOMORROW');
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it('is byte-stable for the same inputs', async () => {
    const src = readFileSync('tests/fixtures/banner/square-1080.jpg');
    const a = await renderBannerServer(src, config, 'TODAY');
    const b = await renderBannerServer(src, config, 'TODAY');
    expect(a.equals(b)).toBe(true);
  });
});

// Layer 1 — Unit assertion on the SVG shape. The fix replaces <text> with
// <path> and removes the @font-face block. This test would have caught the
// original tofu regression at the source: the SVG itself is wrong if it
// still relies on librsvg+fontconfig to render glyphs.
describe('buildBannerSvg', () => {
  it('emits <path> for the label, not <text>, with no @font-face block', () => {
    const svg = buildBannerSvg({
      width: 1080,
      height: 1920,
      config: rightStripConfig,
      label: 'TONIGHT',
    });

    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('@font-face');
  });

  it('ignores non-fixed position config and emits the fixed right-side strip', () => {
    const svg = buildBannerSvg({
      width: 1080,
      height: 1080,
      config,
      label: 'THIS WEDNESDAY',
    });

    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
    expect(svg).toContain('rotate');
    expect(svg).toContain('#a57626');
  });
});

// Layer 3 — Visual sanity. Tofu rendering produces a strip of a flat colour
// with at most a small handful of luma values (background + thin outline).
// Real glyphs produce a histogram with many distinct intensity levels because
// font shapes have varied stroke thickness, anti-aliased edges, and curves.
// Threshold tuned generously: tofu produces ~3–4 buckets; real glyphs
// produce 20+. We assert >8.
describe('renderBannerServer visual sanity', () => {
  it('right-edge strip contains varied pixel intensity (real glyphs, not flat colour or tofu)', async () => {
    const src = readFileSync('tests/fixtures/banner/square-1080.jpg');
    const out = await renderBannerServer(src, rightStripConfig, 'TONIGHT');

    const meta = await sharp(out).metadata();
    if (!meta.width || !meta.height) throw new Error('rendered output missing dimensions');
    const stripPx = Math.round(Math.min(meta.width, meta.height) * 0.07);
    const stripCenterX = meta.width - Math.floor(stripPx / 2);

    const raw = await sharp(out)
      .extract({ left: stripCenterX, top: 0, width: 1, height: meta.height })
      .raw()
      .toBuffer();

    // 32-bucket luma histogram. Average RGB and quantise to 8-step buckets
    // so noise doesn't inflate the count for flat-colour tofu output.
    const distinct = new Set<number>();
    for (let i = 0; i + 2 < raw.length; i += 3) {
      const luma = Math.round((raw[i] + raw[i + 1] + raw[i + 2]) / 3 / 8) * 8;
      distinct.add(luma);
    }
    expect(distinct.size).toBeGreaterThan(8);
  });
});
