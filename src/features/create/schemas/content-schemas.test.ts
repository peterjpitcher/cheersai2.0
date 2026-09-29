import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  instantPostBriefSchema,
  eventBriefSchema,
  promotionBriefSchema,
  weeklyCampaignBriefSchema,
  contentBriefSchema,
  contentBriefSubmissionSchema,
  OFFER_DATE_MESSAGES,
} from './content-schemas';

describe('Content Zod Schemas', () => {
  const baseFields = {
    title: 'Test Post',
    platforms: ['facebook'] as const,
  };

  describe('instantPostBriefSchema', () => {
    it('should validate a valid instant post brief', () => {
      const input = {
        ...baseFields,
        contentType: 'instant_post' as const,
        publishMode: 'now' as const,
      };
      const result = instantPostBriefSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty title (min 1 char)', () => {
      const input = {
        title: '',
        platforms: ['facebook'] as const,
        contentType: 'instant_post' as const,
        publishMode: 'now' as const,
      };
      const result = instantPostBriefSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject empty platforms array', () => {
      const input = {
        title: 'Test',
        platforms: [],
        contentType: 'instant_post' as const,
        publishMode: 'now' as const,
      };
      const result = instantPostBriefSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('eventBriefSchema', () => {
    it('should require eventName, eventDate, eventTime', () => {
      const input = {
        ...baseFields,
        contentType: 'event' as const,
        eventName: 'Quiz Night',
        eventDate: '2026-06-15',
        eventTime: '19:30',
      };
      const result = eventBriefSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject eventTime not matching HH:MM format', () => {
      const input = {
        ...baseFields,
        contentType: 'event' as const,
        eventName: 'Quiz Night',
        eventDate: '2026-06-15',
        eventTime: '7:30pm',
      };
      const result = eventBriefSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('eventBriefSchema placements', () => {
    const base = {
      contentType: 'event' as const,
      title: 'Quiz Night',
      eventName: 'Quiz Night',
      eventDate: '2026-06-15',
      eventTime: '19:00',
      platforms: ['facebook', 'instagram'] as Array<'facebook' | 'instagram'>,
    };

    it('defaults to posting on the feed and as a story', () => {
      // Both, without anyone having to remember to tick the second one.
      const result = eventBriefSchema.safeParse(base);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.placements).toEqual(['feed', 'story']);
    });

    it('accepts feed and story together', () => {
      const result = eventBriefSchema.safeParse({ ...base, placements: ['feed', 'story'] });
      expect(result.success).toBe(true);
    });

    it('still allows a feed-only or story-only event', () => {
      expect(eventBriefSchema.safeParse({ ...base, placements: ['feed'] }).success).toBe(true);
      expect(eventBriefSchema.safeParse({ ...base, placements: ['story'] }).success).toBe(true);
    });

    it('requires at least one placement', () => {
      expect(eventBriefSchema.safeParse({ ...base, placements: [] }).success).toBe(false);
    });
  });

  describe('promotionBriefSchema', () => {
    it('should require offerSummary and endDate', () => {
      const input = {
        ...baseFields,
        contentType: 'promotion' as const,
        offerSummary: '2-for-1 cocktails',
        endDate: '2026-07-01',
      };
      const result = promotionBriefSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('offer start and end dates', () => {
    const offer = {
      ...baseFields,
      contentType: 'promotion' as const,
      offerSummary: '2-for-1 cocktails',
    };

    /** Tuesday 29 September 2026, 09:00 BST. */
    const TUESDAY_MORNING = '2026-09-29T08:00:00.000Z';

    function pinClock(iso: string): void {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));
    }

    function issues(schema: typeof contentBriefSchema, input: Record<string, unknown>) {
      const result = schema.safeParse(input);
      return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('refuses a start date after the end date, on the start date field', () => {
      const input = { ...offer, startDate: '2026-10-20', endDate: '2026-10-09' };

      expect(issues(contentBriefSchema, input)).toEqual([
        { path: 'startDate', message: OFFER_DATE_MESSAGES.startAfterEnd },
      ]);
      expect(promotionBriefSchema.safeParse(input).success).toBe(false);
    });

    it('accepts a start date on the end date, before it, blank or missing', () => {
      for (const startDate of ['2026-10-09', '2026-10-01', '', undefined]) {
        expect(issues(contentBriefSchema, { ...offer, startDate, endDate: '2026-10-09' })).toEqual([]);
      }
    });

    it('leaves the stored-brief schema free of today\'s date, so an old brief still parses', () => {
      pinClock(TUESDAY_MORNING);
      expect(issues(contentBriefSchema, { ...offer, endDate: '2026-09-28' })).toEqual([]);
    });

    it('refuses an end date that has passed when the brief is submitted', () => {
      pinClock(TUESDAY_MORNING);

      expect(issues(contentBriefSubmissionSchema, { ...offer, endDate: '2026-09-28' })).toEqual([
        { path: 'endDate', message: OFFER_DATE_MESSAGES.endDatePassed },
      ]);
      expect(OFFER_DATE_MESSAGES.endDatePassed).toBe('The offer end date has passed. Choose today or a later date.');
    });

    it('accepts an end date of today or later when the brief is submitted', () => {
      pinClock(TUESDAY_MORNING);

      expect(issues(contentBriefSubmissionSchema, { ...offer, endDate: '2026-09-29' })).toEqual([]);
      expect(issues(contentBriefSubmissionSchema, { ...offer, startDate: '2026-10-05', endDate: '2026-10-15' })).toEqual([]);
    });

    it('refuses a start date after the end date when the brief is submitted', () => {
      pinClock(TUESDAY_MORNING);

      expect(issues(contentBriefSubmissionSchema, { ...offer, startDate: '2026-10-20', endDate: '2026-10-09' })).toEqual([
        { path: 'startDate', message: OFFER_DATE_MESSAGES.startAfterEnd },
      ]);
    });

    it('reports a passed end date alongside the other problems in the brief', () => {
      pinClock(TUESDAY_MORNING);

      expect(issues(contentBriefSubmissionSchema, { ...offer, offerSummary: '', endDate: '2026-09-28' })).toEqual([
        { path: 'offerSummary', message: 'Describe the offer' },
        { path: 'endDate', message: OFFER_DATE_MESSAGES.endDatePassed },
      ]);
    });

    it('uses the London date around the clock change, not the UTC date', () => {
      // 23:30 UTC on Saturday 24 October is 00:30 BST on Sunday 25 October in
      // London: an offer that ended on the 24th has ended, although the UTC
      // date is still the 24th.
      pinClock('2026-10-24T23:30:00.000Z');
      expect(issues(contentBriefSubmissionSchema, { ...offer, endDate: '2026-10-24' })).toEqual([
        { path: 'endDate', message: OFFER_DATE_MESSAGES.endDatePassed },
      ]);
      expect(issues(contentBriefSubmissionSchema, { ...offer, endDate: '2026-10-25' })).toEqual([]);

      // 23:30 GMT on Sunday 25 October, after the clocks went back: still the 25th.
      pinClock('2026-10-25T23:30:00.000Z');
      expect(issues(contentBriefSubmissionSchema, { ...offer, endDate: '2026-10-25' })).toEqual([]);
    });
  });

  describe('weeklyCampaignBriefSchema (multi-day + end date)', () => {
    const weeklyBase = {
      ...baseFields,
      contentType: 'weekly_recurring' as const,
      time: '19:00',
      endDate: '2026-08-31',
    };

    it('accepts a single day', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [3] });
      expect(result.success).toBe(true);
    });

    it('accepts multiple unique days', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [1, 4] });
      expect(result.success).toBe(true);
    });

    it('rejects an empty days array', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [] });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate days', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [2, 2] });
      expect(result.success).toBe(false);
    });

    it('rejects a day outside 0-6', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [7] });
      expect(result.success).toBe(false);
    });

    it('rejects a malformed end date', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [1], endDate: '31/08/2026' });
      expect(result.success).toBe(false);
    });

    it('rejects a malformed time', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [1], time: '7pm' });
      expect(result.success).toBe(false);
    });

    it('defaults placement to feed when omitted', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [1] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.placement).toBe('feed');
      }
    });

    it('accepts a story placement', () => {
      const result = weeklyCampaignBriefSchema.safeParse({ ...weeklyBase, daysOfWeek: [5], placement: 'story' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.placement).toBe('story');
      }
    });

    it('carries the optional ctaLinks field', () => {
      const result = weeklyCampaignBriefSchema.safeParse({
        ...weeklyBase,
        daysOfWeek: [1],
        ctaLinks: { facebook: 'https://book.example', instagram: 'https://book.example' },
      });
      expect(result.success).toBe(true);
    });

    it('trims optional ctaLabel only when parsed', () => {
      const result = weeklyCampaignBriefSchema.safeParse({
        ...weeklyBase,
        daysOfWeek: [1],
        ctaLabel: '  Book a table  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ctaLabel).toBe('Book a table');
      }
    });

    it('treats a blank ctaLabel as unset', () => {
      const result = weeklyCampaignBriefSchema.safeParse({
        ...weeklyBase,
        daysOfWeek: [1],
        ctaLabel: '   ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ctaLabel).toBeUndefined();
      }
    });
  });

  describe('contentBriefSchema (discriminated union)', () => {
    it('should parse correct type based on contentType field', () => {
      const instantPost = {
        ...baseFields,
        contentType: 'instant_post' as const,
        publishMode: 'schedule' as const,
        scheduledFor: '2026-06-15T19:30:00Z',
      };
      const result = contentBriefSchema.safeParse(instantPost);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contentType).toBe('instant_post');
      }

      const event = {
        ...baseFields,
        contentType: 'event' as const,
        eventName: 'Live Music',
        eventDate: '2026-06-20',
        eventTime: '20:00',
      };
      const eventResult = contentBriefSchema.safeParse(event);
      expect(eventResult.success).toBe(true);
      if (eventResult.success) {
        expect(eventResult.data.contentType).toBe('event');
      }
    });
  });
});
