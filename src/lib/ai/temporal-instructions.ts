/**
 * Build label-specific narrative framing for AI content generation.
 *
 * Maps schedule slot labels (e.g. "Event day", "2 days to go", "Last chance")
 * to the narrative job of that post: is it the first announcement, a mid-run
 * reminder, or the final nudge?
 *
 * These instructions deliberately carry NO date or countdown vocabulary. The
 * timing block in buildUserPrompt owns every date claim, including which
 * relative words are true for the post. When this function also issued date
 * wording the two contradicted each other, e.g. "do not fall back to vague
 * relative or countdown wording" immediately followed by "use forward-looking
 * language like just 5 days away".
 */

export function buildTemporalInstructions(slotLabel?: string): string {
  if (!slotLabel) return '';

  const lower = slotLabel.toLowerCase();

  if (lower === 'event day') {
    return [
      'Slot purpose: this post goes out on the day of the event itself.',
      'Write with immediacy and energy. Follow the timing block for the exact wording.',
    ].join('\n');
  }

  if (lower === 'last chance') {
    return [
      'Slot purpose: this is the final post before the promotion ends.',
      'Communicate deadline urgency without inventing scarcity. Be factual about the deadline.',
    ].join('\n');
  }

  const countdownMatch = lower.match(/^(\d+)\s+(day|week)s?\s+to\s+go$/);
  if (countdownMatch) {
    return [
      'Slot purpose: this is a reminder post in the run-up, building anticipation.',
      'Take the remaining time from the timing block. Do not invent your own countdown.',
    ].join('\n');
  }

  if (lower.includes('hype') || lower.includes('week')) {
    return [
      `Slot purpose: "${slotLabel}", a lead-up post building anticipation.`,
      'Look forward to the event without stating a countdown of your own.',
    ].join('\n');
  }

  return `Slot purpose: "${slotLabel}", write copy that fits this narrative moment.`;
}
