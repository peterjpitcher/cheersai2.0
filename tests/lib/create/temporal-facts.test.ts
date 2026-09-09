import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

import { buildUserPrompt } from '@/lib/ai/prompts';
import {
  buildGenerationTemporalContext,
  resolveEffectivePublishAt,
  splitRelativeWording,
} from '@/lib/create/temporal-context';
import type { ContentBrief } from '@/features/create/schemas/content-schemas';

const TZ = 'Europe/London';

/** Frozen clock so "post now" is deterministic. Tuesday. */
const CLOCK = DateTime.fromISO('2026-09-08T15:40:00', { zone: TZ });

const BASE = {
  title: 'Quiz Night',
  prompt: 'Our weekly pub quiz.',
  platforms: ['facebook'],
  tone: 'friendly_warm',
  lengthPreference: 'standard',
  ctaStyle: 'default',
  proofPoints: [],
  includeHashtags: true,
  includeEmojis: true,
  placements: ['feed'],
} as const;

function eventBrief(date: string, time = '19:00') {
  return {
    ...BASE,
    contentType: 'event',
    eventName: 'Quiz Night',
    eventDate: date,
    eventTime: time,
  } as unknown as ContentBrief;
}

function promotionBrief(endDate: string) {
  return {
    ...BASE,
    contentType: 'promotion',
    offerSummary: 'Two for one on burgers',
    endDate,
  } as unknown as ContentBrief;
}

function promptFor(brief: ContentBrief, scheduledAt: string | null, referenceAt = CLOCK) {
  const context = buildGenerationTemporalContext({
    contentType: brief.contentType,
    brief: brief as unknown as Record<string, unknown>,
    scheduledAt,
    referenceAt,
  });
  return {
    context,
    prompt: buildUserPrompt(brief, undefined, { scheduledAt, ...context }),
  };
}

describe('resolveEffectivePublishAt', () => {
  it('uses a valid schedule when one is supplied', () => {
    const result = resolveEffectivePublishAt({
      scheduledAt: '2026-09-14T10:00:00+01:00',
      referenceAt: CLOCK,
    });
    expect(result.kind).toBe('scheduled');
    expect(result.at?.toISO()).toContain('2026-09-14T10:00:00');
  });

  it('falls back to the injected clock when there is no schedule', () => {
    const result = resolveEffectivePublishAt({ scheduledAt: null, referenceAt: CLOCK });
    expect(result.kind).toBe('now');
    expect(result.at?.toISO()).toContain('2026-09-08T15:40:00');
  });

  it('treats an empty schedule string as post-now, not as invalid', () => {
    expect(resolveEffectivePublishAt({ scheduledAt: '   ', referenceAt: CLOCK }).kind).toBe('now');
  });

  it('reports an unparseable schedule as invalid rather than as now', () => {
    const result = resolveEffectivePublishAt({ scheduledAt: 'not-a-date', referenceAt: CLOCK });
    expect(result.kind).toBe('invalid');
    expect(result.at).toBeNull();
  });
});

describe('post-now temporal framing', () => {
  it('does not claim an event 11 days away is happening now', () => {
    const { context, prompt } = promptFor(eventBrief('2026-09-19'), null);

    // The regression: a null schedule used to mean "the event is live".
    expect(context.timingLabel).toBe('early_awareness');
    expect(context.forbiddenRelativeWording).toEqual(['today', 'tonight', 'tomorrow']);
    expect(prompt).not.toContain('happening now');
    expect(prompt).toContain('Do not describe it as happening "today", "tonight" or "tomorrow"');
    // The publish anchor may legitimately say "today", so assert on the event
    // claim rather than on the whole prompt containing the word.
    expect(prompt).toContain('The event is on Saturday 19th September at 7pm, 11 days after this post publishes.');
  });

  it('still anchors the post to a date when publishing immediately', () => {
    const { prompt } = promptFor(eventBrief('2026-09-19'), null);
    expect(prompt).toContain('This post publishes immediately, today, Tuesday 8th September at 3:40pm.');
  });

  it('gives an instant post with no event a publish anchor', () => {
    const brief = { ...BASE, contentType: 'instant_post' } as unknown as ContentBrief;
    const { prompt } = promptFor(brief, null);
    expect(prompt).toContain('This post publishes immediately, today, Tuesday 8th September at 3:40pm.');
  });

  it('makes no temporal claim at all when the schedule cannot be parsed', () => {
    const { context } = promptFor(eventBrief('2026-09-19'), 'not-a-date');
    expect(context).toEqual({});
  });
});

describe('day-gap matrix', () => {
  // Event at 19:00 on Saturday 19 September 2026 (BST).
  const cases: Array<{
    label: string;
    scheduledAt: string;
    allowed: string[];
    forbidden: string[];
    gapPhrase: string;
  }> = [
    {
      label: 'day after the event',
      scheduledAt: '2026-09-20T10:00:00+01:00',
      allowed: [],
      forbidden: ['today', 'tonight', 'tomorrow'],
      gapPhrase: 'the day before this post publishes',
    },
    {
      label: 'event day, morning',
      scheduledAt: '2026-09-19T07:00:00+01:00',
      allowed: ['tonight'],
      forbidden: ['today', 'tomorrow'],
      gapPhrase: 'the same day this post publishes',
    },
    {
      label: 'day before',
      scheduledAt: '2026-09-18T10:00:00+01:00',
      allowed: ['tomorrow'],
      forbidden: ['today', 'tonight'],
      gapPhrase: 'the day after this post publishes',
    },
    {
      label: 'two days before',
      scheduledAt: '2026-09-17T10:00:00+01:00',
      allowed: [],
      forbidden: ['today', 'tonight', 'tomorrow'],
      gapPhrase: '2 days after this post publishes',
    },
    {
      label: 'six days before',
      scheduledAt: '2026-09-13T10:00:00+01:00',
      allowed: [],
      forbidden: ['today', 'tonight', 'tomorrow'],
      gapPhrase: '6 days after this post publishes',
    },
    {
      label: 'twenty-one days before',
      scheduledAt: '2026-08-29T10:00:00+01:00',
      allowed: [],
      forbidden: ['today', 'tonight', 'tomorrow'],
      gapPhrase: '21 days after this post publishes',
    },
  ];

  for (const testCase of cases) {
    it(`states the gap and the vocabulary for ${testCase.label}`, () => {
      const { context, prompt } = promptFor(eventBrief('2026-09-19'), testCase.scheduledAt);
      expect(context.allowedRelativeWording).toEqual(testCase.allowed);
      expect(context.forbiddenRelativeWording).toEqual(testCase.forbidden);
      expect(context.absoluteDateLabel).toBe('Saturday 19th September');
      expect(prompt).toContain(testCase.gapPhrase);
      expect(prompt).toContain('Timing (Europe/London):');
    });
  }

  it('permits "today" rather than "tonight" for a lunchtime event', () => {
    const { context } = promptFor(eventBrief('2026-09-19', '12:00'), '2026-09-19T07:00:00+01:00');
    expect(context.allowedRelativeWording).toEqual(['today']);
    expect(context.forbiddenRelativeWording).toContain('tonight');
  });

  it('permits both same-day forms for a promotion, which runs to end of day', () => {
    const { context } = promptFor(promotionBrief('2026-09-19'), '2026-09-19T09:00:00+01:00');
    expect(context.allowedRelativeWording).toEqual(['today', 'tonight']);
    expect(context.forbiddenRelativeWording).toEqual(['tomorrow']);
  });
});

describe('the prompt never contradicts itself', () => {
  const schedules = [
    '2026-09-20T10:00:00+01:00',
    '2026-09-19T07:00:00+01:00',
    '2026-09-19T17:00:00+01:00',
    '2026-09-19T18:30:00+01:00',
    '2026-09-18T10:00:00+01:00',
    '2026-09-17T10:00:00+01:00',
    '2026-09-14T10:00:00+01:00',
    '2026-08-29T10:00:00+01:00',
    null,
  ];

  for (const scheduledAt of schedules) {
    it(`never instructs a forbidden word for schedule ${scheduledAt ?? 'post-now'}`, () => {
      for (const brief of [eventBrief('2026-09-19'), eventBrief('2026-09-19', '12:00'), promotionBrief('2026-09-19')]) {
        const { context, prompt } = promptFor(brief, scheduledAt);
        for (const word of context.forbiddenRelativeWording ?? []) {
          expect(prompt).not.toContain(`You may describe it as happening "${word}"`);
          // The intent line must not tell the model to use a word the block bans.
          expect(prompt).not.toContain(`Use "${word}"`);
          expect(prompt).not.toContain(`(${word} at`);
        }
      }
    });
  }
});

describe('date formatting', () => {
  it('writes every rendered date in the ordinal house style', () => {
    const { prompt } = promptFor(eventBrief('2026-09-19'), '2026-09-14T10:00:00+01:00');
    const timingBlock = prompt.slice(prompt.indexOf('Timing (Europe/London):'));
    // "Saturday 19 September" without the ordinal is the form that used to leak.
    expect(timingBlock).not.toMatch(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December)\b/);
    expect(timingBlock).toContain('Saturday 19th September');
    expect(timingBlock).toContain('Monday 14th September');
  });

  it('never emits a raw ISO date', () => {
    const { prompt } = promptFor(eventBrief('2026-09-19'), '2026-09-14T10:00:00+01:00');
    expect(prompt).not.toContain('2026-09-19');
  });
});

describe('British Summer Time boundaries', () => {
  // Clocks go forward 29 March 2026, back 25 October 2026.
  it('treats the day either side of the spring change as one day apart', () => {
    const publishAt = DateTime.fromISO('2026-03-28T20:00:00', { zone: TZ });
    const target = DateTime.fromISO('2026-03-29T20:00:00', { zone: TZ });
    expect(splitRelativeWording(publishAt, target).allowed).toEqual(['tomorrow']);
  });

  it('treats the day either side of the autumn change as one day apart', () => {
    const publishAt = DateTime.fromISO('2026-10-24T20:00:00', { zone: TZ });
    const target = DateTime.fromISO('2026-10-25T20:00:00', { zone: TZ });
    expect(splitRelativeWording(publishAt, target).allowed).toEqual(['tomorrow']);
  });

  it('keeps the same-day form across the spring change', () => {
    const publishAt = DateTime.fromISO('2026-03-29T00:30:00', { zone: TZ });
    const target = DateTime.fromISO('2026-03-29T20:00:00', { zone: TZ });
    expect(splitRelativeWording(publishAt, target).allowed).toEqual(['tonight']);
  });

  it('keeps the same-day form across the autumn change', () => {
    const publishAt = DateTime.fromISO('2026-10-25T00:30:00', { zone: TZ });
    const target = DateTime.fromISO('2026-10-25T20:00:00', { zone: TZ });
    expect(splitRelativeWording(publishAt, target).allowed).toEqual(['tonight']);
  });

  it('describes a BST event date correctly from a GMT publish date', () => {
    const { prompt } = promptFor(eventBrief('2026-03-29', '19:00'), '2026-03-27T10:00:00+00:00');
    expect(prompt).toContain('Sunday 29th March');
    expect(prompt).toContain('2 days after this post publishes');
  });
});
