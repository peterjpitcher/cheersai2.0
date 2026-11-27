import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

// satori 0.33+ loads harfbuzzjs, which reads hb.wasm from its own folder at
// runtime. Bundled by webpack the file goes missing in production and every
// tournament overlay fails ("ENOENT ... chunks/hb.wasm", 27 November 2026).
describe('next.config satori packaging', () => {
  it('should keep satori and harfbuzzjs out of the webpack bundle', () => {
    expect(nextConfig.serverExternalPackages).toEqual(expect.arrayContaining(['sharp', 'satori', 'harfbuzzjs']));
  });

  it('should ship hb.wasm with every server function', () => {
    const includes = Object.values(nextConfig.outputFileTracingIncludes ?? {}).flat();
    expect(includes).toContain('./node_modules/harfbuzzjs/hb.wasm');
  });
});
