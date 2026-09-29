/**
 * Colour tokens for the one place CSS variables cannot reach: images drawn by
 * next/og (the share images), where satori needs literal colours.
 *
 * Each entry is a copy of the token of the same name in src/app/globals.css,
 * which stays the source of truth; tokens.test.ts fails if a value here ever
 * differs from globals.css. Pages and components use the CSS variables, never
 * this file.
 */
export const DESIGN_TOKENS = {
  '--c-paper': '#F6F7F9',
  '--c-card': '#FFFFFF',
  '--c-ink': '#101828',
  '--c-ink-2': '#344054',
  '--c-ink-4': '#98A2B3',
  '--c-line-2': '#D0D5DD',
  '--c-orange': '#DC6803',
  '--c-orange-hi': '#B54708',
  '--c-orange-soft': '#FEF0C7',
  '--c-fb': '#1B4DB1',
  '--c-ig': '#B72A6B',
} as const;

export type DesignToken = keyof typeof DESIGN_TOKENS;

export function token(name: DesignToken): string {
  return DESIGN_TOKENS[name];
}
