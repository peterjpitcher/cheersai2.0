import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESIGN_TOKENS } from '@/lib/design/tokens';

/**
 * The share images use a copy of the colour tokens (satori cannot read CSS
 * variables). globals.css stays the source of truth: this fails the moment a
 * copied value differs from it.
 */

function rootTokens(): Map<string, string> {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const root = /:root\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? '';
  const tokens = new Map<string, string>();
  for (const match of root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

describe('design token mirror', () => {
  it('matches globals.css for every token it copies', () => {
    const tokens = rootTokens();
    expect(tokens.size).toBeGreaterThan(20);
    for (const [name, value] of Object.entries(DESIGN_TOKENS)) {
      expect(tokens.get(name)?.toUpperCase(), name).toBe(value.toUpperCase());
    }
  });
});
