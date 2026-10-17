/**
 * Which OpenAI model writes post copy (tasks/SPEC-event-copy-engine.md B4).
 *
 * gpt-5.5 since 17 October 2026, on the owner's yes. A side-by-side on 10 real
 * briefs had gpt-4o-mini's first drafts clean 3 times in 10, against 10 in 10
 * for gpt-5.4-mini and gpt-5.5, and gpt-5.5 then wrote all 66 of the autumn's
 * scheduled event posts with no house-style problem. About 6 US cents and 25 to
 * 35 seconds a post. OPENAI_MODEL still overrides it.
 */
export const DEFAULT_COPY_MODEL = 'gpt-5.5';

/**
 * Image naming and tagging keeps its own model. It used to read OPENAI_MODEL
 * too, so switching the copy model to a reasoning model would have broken it
 * (they reject its temperature) and multiplied its cost for no gain.
 */
export const DEFAULT_MEDIA_TAGGING_MODEL = 'gpt-4o-mini';

/** The copy model in use: OPENAI_MODEL when set, otherwise the default. */
export function resolveCopyModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_COPY_MODEL;
}

/**
 * GPT-5 and later, and the o-series, are reasoning models: they reject a custom
 * temperature and can take far longer (gpt-5.5 averaged 24 seconds a post).
 */
export function isReasoningModel(model: string): boolean {
  return /^(?:gpt-(?:[5-9]|\d{2,})|o\d)/i.test(model.trim());
}

/** How long one copy request may take before the owner is told to try again. */
export function copyTimeoutMs(model: string): number {
  return isReasoningModel(model) ? 60_000 : 30_000;
}
