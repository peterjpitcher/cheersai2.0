import { DateTime } from 'luxon';

import { buildGenerationTemporalContext } from '@/lib/create/temporal-context';
import type { ContentType } from '@/types/content';

/**
 * Does already-written copy still tell the truth if the post moves?
 *
 * The banner proximity label is recomputed at publish time from the current
 * `scheduled_for`, but the body copy is frozen when it is generated. Move a
 * Friday event post from Thursday to Monday and the image strip flips from
 * TOMORROW to THIS FRIDAY while the caption underneath still says "tomorrow".
 *
 * The check is deliberately narrow. Wording that is relative to *publication*
 * ("book today") never goes stale on its own: it means the day the reader sees
 * it, whenever that is. Only wording about a *fixed* subject can become untrue,
 * so this evaluates the copy against the same permitted vocabulary the
 * generator used, recomputed for the proposed publish time. An absolute date
 * ("Saturday 19th September") stays true however the post moves, so it never
 * triggers a warning.
 */

export interface TemporalDriftResult {
  /** True only when the body contains wording that would be untrue. */
  stale: boolean;
  /**
   * False when there was nothing to check against: no brief, an unsupported
   * content type, or no fixed subject. This is "not evaluated", NOT proof that
   * the copy is fine.
   */
  evaluated: boolean;
  /** The wording found in the body that the new time makes untrue. */
  untrue: string[];
  message: string | null;
}

const NOT_EVALUATED: TemporalDriftResult = {
  stale: false,
  evaluated: false,
  untrue: [],
  message: null,
};

/**
 * "Book today", "call today" and friends address the reader, not the event.
 * They stay true whenever the post goes out, so they must not raise a warning.
 */
const CTA_LEAD_IN = /\b(?:book|booking|reserve|reserving|call|ring|order|message|grab|join|pop in|come down|get in touch)\b[^.!?\n]{0,40}$/i;

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find real uses of a phrase in the body, skipping any that read as a
 * call to action rather than a claim about when the thing happens.
 */
function mentions(body: string, phrase: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
  for (const match of body.matchAll(pattern)) {
    const before = body.slice(0, match.index ?? 0);
    if (CTA_LEAD_IN.test(before)) continue;
    return true;
  }
  return false;
}

export function evaluateTemporalDrift({
  body,
  promptContext,
  publishAt,
}: {
  body: string;
  promptContext: Record<string, unknown> | null;
  publishAt: DateTime;
}): TemporalDriftResult {
  if (!body.trim() || !publishAt.isValid) return NOT_EVALUATED;

  const context = readRecord(promptContext);
  const brief = readRecord(context?.brief);
  const contentType = brief?.contentType;
  if (!brief || typeof contentType !== 'string') return NOT_EVALUATED;

  const scheduledAt = publishAt.toISO();
  if (!scheduledAt) return NOT_EVALUATED;

  const temporal = buildGenerationTemporalContext({
    contentType: contentType as ContentType,
    brief,
    scheduledAt,
  });

  const forbidden = temporal.forbiddenRelativeWording ?? [];
  // No fixed subject (an instant post, or a brief missing its dates) means
  // there is nothing the new time could make untrue.
  if (!forbidden.length) return NOT_EVALUATED;

  const untrue = forbidden.filter((phrase) => mentions(body, phrase));
  if (!untrue.length) {
    return { stale: false, evaluated: true, untrue: [], message: null };
  }

  const quoted = untrue.map((phrase) => `"${phrase}"`);
  const list = quoted.length === 1
    ? quoted[0]
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;

  return {
    stale: true,
    evaluated: true,
    untrue,
    message: `This post says ${list}, which will no longer be true at the new time. Regenerate or edit the copy before it goes out.`,
  };
}
