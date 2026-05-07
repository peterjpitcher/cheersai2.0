// src/lib/banner/render-server.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import { renderBannerServer } from '@/lib/banner/render-server';
import type { ResolvedConfig } from '@/lib/banner/config';

const config: ResolvedConfig = {
  enabled: true,
  position: 'bottom',
  bgColour: '#000000',
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
