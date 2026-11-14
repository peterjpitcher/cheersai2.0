import { describe, it, expect } from 'vitest';
import { buildCampaignMetadata } from '@/lib/publishing/build-campaign-metadata';

describe('buildCampaignMetadata', () => {
  it('builds event metadata with top-level timing fields', () => {
    const result = buildCampaignMetadata('event', {
      title: 'Quiz Night',
      eventDate: '2026-06-15',
      eventTime: '19:30',
      eventEndDate: '2026-06-15',
    }, 3);

    expect(result).toMatchObject({
      startDate: '2026-06-15',
      startTime: '19:30',
      endDate: '2026-06-15',
      slotCount: 3,
    });
    expect(result.eventStart).toMatch(/^2026-06-15T19:30:00/);
    expect(result.brief).toBeDefined();
  });

  it('builds event metadata without eventEndDate', () => {
    const result = buildCampaignMetadata('event', {
      title: 'Live Music',
      eventDate: '2026-07-01',
      eventTime: '20:00',
    }, 2);

    expect(result).toMatchObject({
      startDate: '2026-07-01',
      startTime: '20:00',
      endDate: null,
      slotCount: 2,
    });
    expect(result.eventStart).toMatch(/^2026-07-01T20:00:00/);
  });

  it('builds promotion metadata with endDate and offerSummary', () => {
    const result = buildCampaignMetadata('promotion', {
      title: 'Summer Sale',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      offerSummary: '2-for-1 drinks',
      couponCode: 'SUMMER26',
    }, 5);

    expect(result).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      offerSummary: '2-for-1 drinks',
      couponCode: 'SUMMER26',
      slotCount: 5,
    });
  });

  it('builds weekly metadata with daysOfWeek, back-compat dayOfWeek and endDate', () => {
    const result = buildCampaignMetadata('weekly_recurring', {
      title: 'Wine Wednesday',
      daysOfWeek: [3, 5],
      time: '17:00',
      endDate: '2026-08-31',
    }, 4);

    expect(result).toMatchObject({
      daysOfWeek: [3, 5],
      dayOfWeek: 3,
      time: '17:00',
      endDate: '2026-08-31',
      slotCount: 4,
    });
    expect('weeksAhead' in result).toBe(false);
  });

  it('falls back to defaults for weekly with missing daysOfWeek/endDate', () => {
    const result = buildCampaignMetadata('weekly_recurring', {
      title: 'Friday Quiz',
      time: '19:00',
    }, 4);

    expect(result.dayOfWeek).toBe(1);
    expect(result.daysOfWeek).toEqual([]);
    expect(result.endDate).toBeNull();
  });

  it('returns base metadata for instant_post', () => {
    const result = buildCampaignMetadata('instant_post', {
      title: 'Quick update',
    }, 1);

    expect(result).toMatchObject({
      brief: { title: 'Quick update' },
      slotCount: 1,
    });
    // Should not have timing fields
    expect(result.startDate).toBeUndefined();
    expect(result.dayOfWeek).toBeUndefined();
  });

  it('produces metadata compatible with extractCampaignTiming for events', () => {
    // Integration assertion: the metadata shape must parse correctly
    const metadata = buildCampaignMetadata('event', {
      title: 'Quiz Night',
      eventDate: '2026-06-15',
      eventTime: '19:30',
    }, 3);

    // Verify the fields extractCampaignTiming reads are present
    expect(metadata.startDate).toBe('2026-06-15');
    expect(metadata.eventStart).toBeDefined();
    expect(typeof metadata.eventStart).toBe('string');
    expect(metadata.startTime).toBe('19:30');
  });

  it('produces metadata compatible with extractCampaignTiming for weekly', () => {
    const metadata = buildCampaignMetadata('weekly_recurring', {
      title: 'Wine Wednesday',
      daysOfWeek: [3, 5],
      time: '17:00',
      endDate: '2026-08-31',
    }, 4);

    // extractCampaignTiming reads dayOfWeek (first selected day) and time from metadata
    expect(metadata.dayOfWeek).toBe(3);
    expect(metadata.time).toBe('17:00');
  });

  describe('Google event post fields', () => {
    it('stores the resolved end, the event key, the Google link and the booking flag', () => {
      const result = buildCampaignMetadata('event', {
        eventName: 'Quiz Night',
        eventDate: '2026-12-04',
        eventTime: '19:00',
        eventEndTime: '22:30',
        managementEventId: 'evt-20',
        googleCtaUrl: 'https://l.the-anchor.pub/gbp-quiz',
        takesBookings: true,
      }, 3);

      expect(result).toMatchObject({
        eventEnd: '2026-12-04T22:30:00.000+00:00',
        eventEndProblem: null,
        eventTitle: 'Quiz Night',
        sourceEventKey: 'mgmt:evt-20',
        googleCtaUrl: 'https://l.the-anchor.pub/gbp-quiz',
        takesBookings: true,
      });
    });

    it('rolls an overnight end to the next day', () => {
      const result = buildCampaignMetadata('event', { eventDate: '2026-12-31', eventTime: '20:00', eventEndTime: '01:00' }, 1);
      expect(result.eventEnd).toBe('2027-01-01T01:00:00.000+00:00');
    });

    it('leaves the end empty with the reason when no end time was given, changing nothing else', () => {
      const result = buildCampaignMetadata('event', { eventName: 'Live Music', eventDate: '2026-07-01', eventTime: '20:00' }, 2);
      expect(result).toMatchObject({
        eventEnd: null,
        eventEndProblem: 'missing_end_time',
        sourceEventKey: null,
        googleCtaUrl: null,
        takesBookings: false,
        startDate: '2026-07-01',
        startTime: '20:00',
        endDate: null,
      });
      expect(result.eventStart).toMatch(/^2026-07-01T20:00:00/);
    });
  });
});
