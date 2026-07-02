// src/lib/banner/text.ts
//
// Single source of truth for validating and normalising the free-text overlay
// ("banner") label a user can type per post. Consumed by:
//   - createScheduledBatch (create/approval flow, src/app/actions/content.ts)
//   - the planner overlay controls (client + updatePlannerBannerConfig)
//   - the render endpoint charset gate (/api/internal/render-banner)
//
// Two hard constraints drive the rules:
//   1. The DB enforces `char_length(banner_text_override) <= 20`, so 20 graphemes
//      is the cap. Over-length input is truncated (not rejected) to match the
//      long-standing behaviour of the previous per-surface sanitisers.
//   2. The banner is rendered by text-to-svg from the bundled Noto Sans font.
//      The charset mirrors the render endpoint's historical allow-list plus the
//      pound sign (£) — verified present in the font — which is core to pub
//      pricing. Emoji, other control characters, and glyphs the SVG pipeline
//      cannot handle reliably stay excluded so nothing can be saved that would
//      then fail (or render as tofu) at publish time.

export const MAX_BANNER_TEXT_LENGTH = 20;

// Allowed: word chars, whitespace, common punctuation, and the pound sign.
// Superset of the render endpoint's previous LABEL_PATTERN (adds `£`), so every
// previously-valid label — including computed proximity labels — still passes.
export const BANNER_TEXT_PATTERN = /^[\w\s\-:.,!?'"&%@#()/£]+$/u;

function graphemes(value: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(value)].map((s) => s.segment);
}

/**
 * Normalise raw overlay text into the stored form: strip control characters,
 * trim, uppercase, and cap at MAX_BANNER_TEXT_LENGTH graphemes. Returns null
 * when the result is empty — blank/whitespace-only means "no overlay".
 */
export function normaliseBannerText(input: string | null | undefined): string | null {
  if (input == null) return null;
  const cleaned = input.replace(/[\n\r\t\x00-\x1f\x7f]/g, "").trim().toUpperCase();
  if (cleaned.length === 0) return null;
  return graphemes(cleaned).slice(0, MAX_BANNER_TEXT_LENGTH).join("");
}

export type BannerTextValidation =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

/**
 * Validate raw overlay text for persistence. Blank/whitespace-only is valid and
 * means "no overlay" (value: null). Otherwise the normalised value must match
 * the allowed charset; length is enforced by truncation in normaliseBannerText.
 */
export function validateBannerText(input: string | null | undefined): BannerTextValidation {
  const value = normaliseBannerText(input);
  if (value === null) return { ok: true, value: null };
  if (!BANNER_TEXT_PATTERN.test(value)) {
    return {
      ok: false,
      reason: "Overlay text can only use letters, numbers, spaces, £ and basic punctuation",
    };
  }
  return { ok: true, value };
}
