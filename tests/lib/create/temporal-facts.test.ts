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
    // Eleven days out lands in the next calendar week, so the natural form is
    // "next Saturday", matching the overlay label exactly.
    expect(context.allowedRelativeWording).toEqual(['next Saturday']);
    expect(context.proximityLabel).toBe('NEXT SATURDAY');
    expect(context.requiresAbsoluteDate).toBe(true);
    expect(prompt).not.toContain('happening now');
    expect(prompt).toContain('Do not describe it as happening "today", "tonight", "tomorrow" or "this Saturday"');
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
    needsDate: boolean;
  }> = [
    {
      label: 'day after the event',
      scheduledAt: '2026-09-20T10:00:00+01:00',
      allowed: [],
      forbidden: ['today', 'tonight', 'tomorrow', 'this Saturday', 'next Saturday'],
      gapPhrase: 'the day before this post publishes',
      needsDate: true,
    },
    {
      label: 'event day, morning',
      scheduledAt: '2026-09-19T07:00:00+01:00',
      allowed: ['tonight'],
      forbidden: ['today', 'tomorrow', 'this Saturday', 'next Saturday'],
      gapPhrase: 'the same day this post publishes',
      needsDate: false,
    },
    {
      label: 'day before',
      scheduledAt: '2026-09-18T10:00:00+01:00',
      allowed: ['tomorrow'],
      forbidden: ['today', 'tonight', 'this Saturday', 'next Saturday'],
      gapPhrase: 'the day after this post publishes',
      needsDate: false,
    },
    {
      label: 'two days before',
      scheduledAt: '2026-09-17T10:00:00+01:00',
      allowed: ['this Saturday'],
      forbidden: ['today', 'tonight', 'tomorrow', 'next Saturday'],
      gapPhrase: '2 days after this post publishes',
      needsDate: false,
    },
    {
      label: 'six days before',
      scheduledAt: '2026-09-13T10:00:00+01:00',
      allowed: ['this Saturday'],
      forbidden: ['today', 'tonight', 'tomorrow', 'next Saturday'],
      gapPhrase: '6 days after this post publishes',
      needsDate: false,
    },
    {
      label: 'seven days before, the next calendar week',
      scheduledAt: '2026-09-12T10:00:00+01:00',
      allowed: ['next Saturday'],
      forbidden: ['today', 'tonight', 'tomorrow', 'this Saturday'],
      gapPhrase: '7 days after this post publishes',
      needsDate: true,
    },
    {
      label: 'twenty-one days before',
      scheduledAt: '2026-08-29T10:00:00+01:00',
      allowed: [],
      forbidden: ['today', 'tonight', 'tomorrow', 'this Saturday', 'next Saturday'],
      gapPhrase: '21 days after this post publishes',
      needsDate: true,
    },
  ];

  for (const testCase of cases) {
    it(`states the gap and the vocabulary for ${testCase.label}`, () => {
      const { context, prompt } = promptFor(eventBrief('2026-09-19'), testCase.scheduledAt);
      expect(context.allowedRelativeWording).toEqual(testCase.allowed);
      expect(context.forbiddenRelativeWording).toEqual(testCase.forbidden);
      expect(context.requiresAbsoluteDate).toBe(testCase.needsDate);
      expect(context.absoluteDateLabel).toBe('Saturday 19th September');
      expect(prompt).toContain(testCase.gapPhrase);
      expect(prompt).toContain('Timing (Europe/London):');
      expect(prompt).toContain(
        testCase.needsDate ? 'State the full date at least once' : 'if you state it at all',
      );
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
    expect(context.forbiddenRelativeWording).toEqual(['tomorrow', 'this Saturday', 'next Saturday']);
  });

  it('permits "this <weekday>" for a promotion deadline inside the week', () => {
    const { context } = promptFor(promotionBrief('2026-09-19'), '2026-09-14T10:00:00+01:00');
    expect(context.allowedRelativeWording).toEqual(['this Saturday']);
    expect(context.requiresAbsoluteDate).toBe(false);
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

describe('caption wording agrees with the image overlay', () => {
  // The overlay label already encodes the day banding, including the calendar
  // week arithmetic that separates "this Saturday" from "next Saturday". The
  // caption vocabulary is derived from that same label, so agreement is
  // structural rather than a rule two pieces of code have to keep in step.
  const relativeLabel = /^(TODAY|TONIGHT|TOMORROW|TOMORROW NIGHT|THIS [A-Z]+|NEXT [A-Z]+)$/;

  const schedules = [
    '2026-09-19T07:00:00+01:00',
    '2026-09-19T18:30:00+01:00',
    '2026-09-18T10:00:00+01:00',
    '2026-09-17T10:00:00+01:00',
    '2026-09-14T10:00:00+01:00',
    '2026-09-13T10:00:00+01:00',
    '2026-09-12T10:00:00+01:00',
    '2026-09-09T10:00:00+01:00',
    '2026-08-29T10:00:00+01:00',
    '2026-09-20T10:00:00+01:00',
    null,
  ];

  for (const scheduledAt of schedules) {
    it(`matches the overlay for ${scheduledAt ?? 'post-now'}`, () => {
      const { context } = promptFor(eventBrief('2026-09-19'), scheduledAt);
      const label = context.proximityLabel ?? null;
      const allowed = context.allowedRelativeWording ?? [];

      if (label && relativeLabel.test(label)) {
        // "TOMORROW NIGHT" permits "tomorrow": the caption keeps its own voice,
        // it just must not make a different claim.
        expect(allowed).toHaveLength(1);
        expect(label.toLowerCase()).toContain(allowed[0].toLowerCase());
      } else {
        // An absolute-date or absent label means no relative form is true.
        expect(allowed).toEqual([]);
      }
    });
  }

  it('never permits a form the overlay contradicts', () => {
    for (const scheduledAt of schedules) {
      const { context } = promptFor(eventBrief('2026-09-19'), scheduledAt);
      for (const forbidden of context.forbiddenRelativeWording ?? []) {
        expect(context.allowedRelativeWording ?? []).not.toContain(forbidden);
      }
    }
  });

  it('keeps the promotion caption on the deadline, not the overlay start label', () => {
    // A promotion that has not started shows its START on the image while the
    // caption talks about the DEADLINE. Different facts, not a contradiction.
    const { context } = promptFor(promotionBrief('2026-09-30'), '2026-09-28T10:00:00+01:00');
    expect(context.allowedRelativeWording).toEqual(['this Wednesday']);
    expect(context.absoluteDateLabel).toBe('Wednesday 30th September');
  });
});
