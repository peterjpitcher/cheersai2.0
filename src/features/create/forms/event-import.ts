import type { CopyTone } from '@/lib/management-app/event-facts';

/**
 * What an event import does to the brief's notes and tone
 * (tasks/SPEC-event-copy-engine.md B2), kept apart from the form so it can be tested.
 */

/**
 * The notes an import leaves in the brief. With a fact sheet, the summary line
 * would only repeat it, so just the venue's own notes stay. Always replaces what
 * was there, even with nothing, so no earlier event's notes linger.
 */
export function importedBriefText(fields: { description?: string; prompt?: string }, hasFacts: boolean): string {
  const parts = hasFacts ? [fields.description] : [fields.description, fields.prompt];
  return parts.filter((part): part is string => Boolean(part?.trim())).join('\n\n');
}

/**
 * Whether the owner chose the current tone. The form records it (toneChosen);
 * a draft saved before it did falls back to the old rule, where any tone other
 * than the default counts as chosen, so a resumed draft never loses a choice.
 */
export function ownerChoseTone({ toneChosen, tone }: { toneChosen?: boolean; tone?: string }): boolean {
  if (typeof toneChosen === 'boolean') return toneChosen;
  return (tone ?? 'friendly_warm') !== 'friendly_warm';
}

/**
 * The tone after an import, or null to leave it. A tone the owner picked
 * themselves always stays, even Friendly & Warm; otherwise the event's suggested
 * tone replaces any earlier import's suggestion, or the default comes back.
 */
export function toneAfterImport({ ownerChoseTone, suggestedTone }: { ownerChoseTone: boolean; suggestedTone?: CopyTone }): CopyTone | null {
  if (ownerChoseTone) return null;
  return suggestedTone ?? 'friendly_warm';
}
