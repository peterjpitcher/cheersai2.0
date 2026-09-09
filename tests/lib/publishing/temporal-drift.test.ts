import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

import { evaluateTemporalDrift } from '@/lib/publishing/temporal-drift';

const TZ = 'Europe/London';
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ });

/** Mirrors what createScheduledBatch writes into content_items.prompt_context. */
function promptContext(brief: Record<string, unknown>) {
  return { slotKey: 'slot-1', slotLabel: 'Event day', placement: 'feed', brief };
}

const eventBrief = {
  contentType: 'event',
  title: 'Quiz Night',
  eventName: 'Quiz Night',
  eventDate: '2026-09-19', // Saturday
  eventTime: '19:00',
};

describe('evaluateTemporalDrift', () => {
  it('flags "tomorrow" when the post moves away from the day before', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night is tomorrow. Bring your sharpest team and settle in with a pint.',
      promptContext: promptContext(eventBrief),
      // Written for Friday 18th, moved to Monday 14th.
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.stale).toBe(true);
    expect(result.untrue).toEqual(['tomorrow']);
    expect(result.message).toContain('no longer be true');
  });

  it('says nothing when the wording is still true at the new time', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night is tomorrow. Bring your sharpest team and settle in with a pint.',
      promptContext: promptContext(eventBrief),
      // Still the day before the event, just an hour later.
      publishAt: at('2026-09-18T17:00:00'),
    });

    expect(result.evaluated).toBe(true);
    expect(result.stale).toBe(false);
  });

  it('never flags an absolute date, which survives any reschedule', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night lands on Saturday 19th September at 7pm. Bring your sharpest team.',
      promptContext: promptContext(eventBrief),
      publishAt: at('2026-08-30T10:00:00'),
    });

    expect(result.stale).toBe(false);
  });

  it('flags "this Saturday" once the event is no longer this week', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night is on this Saturday at 7pm. Bring your sharpest team.',
      promptContext: promptContext(eventBrief),
      publishAt: at('2026-09-09T10:00:00'), // ten days out, now "next Saturday"
    });

    expect(result.stale).toBe(true);
    expect(result.untrue).toEqual(['this Saturday']);
  });

  it('flags "tonight" when the post moves off the event day', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night is tonight at 7pm. Bring your sharpest team.',
      promptContext: promptContext(eventBrief),
      publishAt: at('2026-09-17T10:00:00'),
    });

    expect(result.stale).toBe(true);
    expect(result.untrue).toEqual(['tonight']);
  });

  it('ignores "today" used as a call to action', () => {
    // "Book today" addresses the reader, not the event. It stays true whenever
    // the post goes out, so warning about it would be noise.
    const result = evaluateTemporalDrift({
      body: 'Quiz night lands on Saturday 19th September. Book your table today to avoid missing out.',
      promptContext: promptContext(eventBrief),
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.stale).toBe(false);
  });

  it('still flags "today" when it is a claim about the event', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night is today at 7pm. Bring your sharpest team and settle in.',
      promptContext: promptContext(eventBrief),
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.stale).toBe(true);
    expect(result.untrue).toContain('today');
  });

  it('lists every phrase that has gone untrue', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night is tonight. See you tomorrow as well for the rematch.',
      promptContext: promptContext(eventBrief),
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.untrue).toEqual(['tonight', 'tomorrow']);
    expect(result.message).toContain('"tonight" and "tomorrow"');
  });

  it('tracks a promotion deadline rather than an event', () => {
    const result = evaluateTemporalDrift({
      body: 'Two for one on burgers, but it ends tomorrow so get in quick.',
      promptContext: promptContext({
        contentType: 'promotion',
        title: 'Burger offer',
        offerSummary: 'Two for one on burgers',
        endDate: '2026-09-19',
      }),
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.stale).toBe(true);
    expect(result.untrue).toEqual(['tomorrow']);
  });

  it('reports "not evaluated" rather than "fine" when there is no brief', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night is tomorrow.',
      promptContext: null,
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.evaluated).toBe(false);
    expect(result.stale).toBe(false);
  });

  it('does not evaluate an instant post, which has no fixed subject', () => {
    // "Tomorrow" in a post with no event date means the day after publication,
    // whenever that is. Moving the post moves the meaning with it.
    const result = evaluateTemporalDrift({
      body: 'Live music tomorrow with the band taking over the back bar.',
      promptContext: promptContext({ contentType: 'instant_post', title: 'Live music' }),
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.evaluated).toBe(false);
  });

  it('does not evaluate an empty body', () => {
    const result = evaluateTemporalDrift({
      body: '   ',
      promptContext: promptContext(eventBrief),
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.evaluated).toBe(false);
  });

  it('does not match a phrase inside a longer word', () => {
    const result = evaluateTemporalDrift({
      body: 'Quiz night lands on Saturday 19th September. Our todays specials board is up.',
      promptContext: promptContext(eventBrief),
      publishAt: at('2026-09-14T10:00:00'),
    });

    expect(result.stale).toBe(false);
  });
});
