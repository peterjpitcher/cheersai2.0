import { SLOT_JOB_LABELS } from '@/lib/ai/slot-jobs';
import { FEED_PLATFORMS, formatDay, londonDate, londonTime, type CalendarPlan, type FeedPlatform, type PlanBatch } from '@/lib/content/calendar-fill';

/** The list the owner approves in one go (tasks/SPEC-social-calendar-fill.md). */

const PLATFORM_NAME: Record<FeedPlatform, string> = { facebook: 'Facebook', instagram: 'Instagram' };

const KIND_HEADING: Record<string, string> = {
  new_campaign: 'New event campaign',
  build_up: 'Extra build-up post',
  lunch: 'Weekday lunch',
  roast: 'Sunday roast',
  private_hire: 'Private hire',
};

function quote(body: string): string {
  return body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function when(iso: string): string {
  return `${formatDay(londonDate(iso))}, ${londonTime(iso)}`;
}

function linkOf(batch: PlanBatch, platform: FeedPlatform): string | null {
  const links = batch.brief.ctaLinks;
  if (!links || typeof links !== 'object') return null;
  const value = (links as Record<string, unknown>)[platform];
  return typeof value === 'string' ? value : null;
}

export function renderCalendarReport(plan: CalendarPlan): string {
  const newSlots = plan.batches.reduce((total, batch) => total + batch.slots.length, 0);
  const movedSlots = plan.moves.length;
  const lines: string[] = [
    `# Posting calendar, ${formatDay(plan.from)} to ${formatDay(plan.to)}`,
    '',
    `Planned ${when(plan.createdAt)} (London) with ${plan.model}. Nothing has changed yet.`,
    '',
    `- **New posts:** ${newSlots}, each on Facebook and Instagram, each with its story at the same minute using the image's upright story version. That is ${newSlots * 4} items.`,
    `- **Time moves:** ${movedSlots} existing slots (${plan.moves.reduce((total, move) => total + move.items.length, 0)} items, feed and story together).`,
    `- **Days left empty:** ${plan.unfilled.length}.`,
    '',
    'Approving applies exactly this list. A post is only added to a day that has had no post added since, and a post is only moved if it is still at its old time and waiting. Anything that has changed is left alone and reported. It can all be undone.',
  ];

  lines.push('', '## The calendar, day by day', '', '| Day | Posts (London time) |', '|---|---|');
  for (const day of plan.days) {
    const entries = day.entries.length
      ? day.entries
          .map((entry) => `${entry.time} ${entry.title}${entry.status === 'new' ? ' **(new)**' : entry.status === 'moved' ? ' **(moved)**' : ''}`)
          .join('<br>')
      : '_empty_';
    lines.push(`| ${formatDay(day.date)} | ${entries} |`);
  }

  if (plan.moves.length) {
    lines.push('', '## Time moves', '');
    for (const move of [...plan.moves].sort((a, b) => a.fromIso.localeCompare(b.fromIso))) {
      const why = move.reason === 'collision' ? 'it shared its minute with another post' : 'build-up posts now go out at 11:00';
      lines.push(`- ${move.campaignName}: ${when(move.fromIso)} to ${londonTime(move.toIso)} (${why}); ${move.items.length} items.`);
    }
  }

  lines.push('', '## New posts');
  for (const batch of plan.batches) {
    lines.push('', `### ${KIND_HEADING[batch.kind] ?? batch.kind}: ${batch.title}`);
    const facebook = linkOf(batch, 'facebook');
    const instagram = linkOf(batch, 'instagram');
    if (facebook) lines.push('', `Facebook link: ${facebook}`);
    if (instagram) lines.push('', `Instagram: "link in bio", whose page carries ${instagram}`);
    const source = plan.sources.find((entry) => entry.subject === batch.kind);
    if (source) lines.push('', `Facts from: ${source.source}`);
    if (batch.artwork) {
      lines.push('', batch.artwork.fileName
        ? `Image: the event's artwork, ${batch.artwork.fileName} (square on the feed, the designed upright version on the story).`
        : "Image: the event's artwork, imported from the events system when this is applied.");
    }
    for (const note of batch.notes) lines.push('', `**Check:** ${note}`);
    for (const slot of batch.slots) {
      lines.push('', `#### ${when(slot.scheduledAt)}, ${slot.label}${slot.job ? ` (${SLOT_JOB_LABELS[slot.job]})` : ''}`);
      if (slot.note) lines.push('', slot.note);
      const photo = slot.mediaIds.map((id) => batch.photos[id]).find(Boolean);
      if (photo && !batch.artwork) lines.push('', `Image: ${photo}, and its upright version on the story.`);
      for (const platform of FEED_PLATFORMS) {
        lines.push('', `**${PLATFORM_NAME[platform]}**`, '', quote(slot.bodies[platform]));
      }
      if (slot.warnings.length) lines.push('', `Warnings: ${slot.warnings.join(' ')}`);
    }
  }

  lines.push('', '## Checks', '');
  lines.push('- Every new event post falls inside its promotion window (after the last event of its type), and the wording of every new post was checked against its date and time.');
  lines.push(plan.ruleBreaks.length
    ? `- **Existing posts before their window:** ${plan.ruleBreaks.map((entry) => `${entry.campaignName} on ${formatDay(entry.date)} (opens ${formatDay(entry.opensOn)}, after ${entry.afterEvent})`).join('; ')}. These are not changed by this plan.`
    : '- No existing post goes out before its promotion window.');

  if (plan.events.length) {
    lines.push('', '### Upcoming events', '', '| Event | Date | Type | Promotion opens | Campaign |', '|---|---|---|---|---|');
    for (const event of plan.events) {
      lines.push(`| ${event.name} | ${formatDay(event.date)} | ${event.category ?? 'none'} | ${event.opensOn ? formatDay(event.opensOn) : 'any time'} | ${event.campaign ?? (plan.batches.some((batch) => batch.title === event.name) ? 'new in this plan' : 'none')} |`);
    }
  }

  if (plan.unfilled.length) {
    lines.push('', '## Not filled', '');
    for (const entry of plan.unfilled) lines.push(`- ${formatDay(entry.date)}: ${entry.reason}`);
  }
  if (plan.notes.length) {
    lines.push('', '## Notes', '');
    for (const note of plan.notes) lines.push(`- ${note}`);
  }
  return `${lines.join('\n')}\n`;
}
