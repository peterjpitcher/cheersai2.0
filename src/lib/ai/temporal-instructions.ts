/**
 * Build label-specific temporal framing instructions for AI content generation.
 *
 * Maps schedule slot labels (e.g. "Event day", "2 days to go", "Last chance")
 * to concrete prompt instructions so the AI writes copy that matches the
 * narrative moment of each scheduled post.
 */

export function buildTemporalInstructions(slotLabel?: string): string {
  if (!slotLabel) return '';

  const lower = slotLabel.toLowerCase();

  if (lower === 'event day') {
    return [
      'Temporal framing: This post goes live on the event day.',
      'Use present tense. Say "today" or "tonight" where natural.',
      'Avoid future-tense phrasing like "coming up" or "this weekend".',
      'Create immediacy — the event is happening NOW.',
    ].join('\n');
  }

  if (lower === 'last chance') {
    return [
      'Temporal framing: This is the final post before a promotion ends.',
      'Communicate clear deadline urgency without misleading scarcity.',
      'Use phrases like "last day", "ends today", "don\'t miss out".',
      'Avoid false urgency — be factual about the deadline.',
    ].join('\n');
  }

  const countdownMatch = lower.match(/^(\d+)\s+(day|week)s?\s+to\s+go$/);
  if (countdownMatch) {
    const [, count, unit] = countdownMatch;
    return [
      `Temporal framing: This post is a countdown — ${count} ${unit}(s) until the event.`,
      'Naturally reference the remaining time without contradicting the scheduled date.',
      `Build anticipation. Use forward-looking language like "just ${count} ${unit}s away".`,
    ].join('\n');
  }

  if (lower.includes('hype') || lower.includes('week')) {
    return [
      `Temporal framing: "${slotLabel}" — a lead-up post building anticipation.`,
      'Use forward-looking language. Mention the upcoming event naturally.',
      'Do not reference a specific countdown unless the label includes one.',
    ].join('\n');
  }

  return `Slot purpose: "${slotLabel}" — write copy that fits this narrative moment.`;
}
