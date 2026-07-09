import { describe, it, expect } from 'vitest';

import {
  instantPostBriefSchema,
  eventBriefSchema,
  promotionBriefSchema,
  weeklyCampaignBriefSchema,
  contentBriefSchema,
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
