/**
 * Infer a semantic label for a manually-added schedule slot based on the
 * content brief context. Used as a fallback when no suggestion label exists.
 *
 * - Events: returns "Event day" when the slot date matches the brief's eventDate.
 * - Promotions: returns "Last chance" when the slot date matches the brief's endDate.
 * - All other cases: returns undefined (no inference possible).
 */

interface BriefContext {
  contentType: string;
  eventDate?: string;
  endDate?: string;
}

export function inferSlotLabel(
  brief: BriefContext,
  slotDate: string,
): string | undefined {
  if (brief.contentType === 'event' && brief.eventDate === slotDate) {
    return 'Event day';
  }

  if (brief.contentType === 'promotion' && brief.endDate === slotDate) {
    return 'Last chance';
  }

  return undefined;
}
