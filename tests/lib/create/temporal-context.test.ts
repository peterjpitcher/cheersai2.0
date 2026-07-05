import { describe, expect, it } from 'vitest';

import {
  buildGenerationTemporalContext,
  getCreatePreviewBannerLabel,
} from '@/lib/create/temporal-context';

describe('create temporal context', () => {
  it('frames event copy as tomorrow and matches the preview overlay label', () => {
    const brief = {
      title: 'Quiz Night',
      contentType: 'event',
      eventName: 'Quiz Night',
      eventDate: '2026-05-27',
      eventTime: '19:00',
    };

    const context = buildGenerationTemporalContext({
      contentType: 'event',
      brief,
      scheduledAt: '2026-05-26T10:00:00.000+01:00',
    });

    expect(context.timingLabel).toBe('tomorrow');
    expect(context.temporalInstruction).toContain('tomorrow');
    expect(context.proximityLabel).toBe('TOMORROW NIGHT');
    expect(context.eventStart).toContain('2026-05-27T19:00:00.000+01:00');
  });

  it('uses this-week wording for events two to six calendar days away', () => {
    const brief = {
      title: 'Quiz Night',
      contentType: 'event',
      eventName: 'Quiz Night',
      eventDate: '2026-05-27',
      eventTime: '19:00',
    };

    const context = buildGenerationTemporalContext({
      contentType: 'event',
      brief,
      scheduledAt: '2026-05-25T10:00:00.000+01:00',
    });

    expect(context.timingLabel).toBe('building');
    // Body copy uses the full absolute date, never a misleading "this"/"next".
    expect(context.temporalInstruction).toContain('Wednesday 27th May');
    expect(context.temporalInstruction).not.toContain('this Wednesday');
    // The overlay label (image) keeps the relative form.
    expect(context.proximityLabel).toBe('THIS WEDNESDAY');
  });

  it('returns today/tonight labels for event-day overlays', () => {
    const label = getCreatePreviewBannerLabel({
      contentType: 'event',
      brief: {
        title: 'Quiz Night',
        eventName: 'Quiz Night',
        eventDate: '2026-05-27',
        eventTime: '19:00',
      },
      scheduledAt: '2026-05-27T10:00:00.000+01:00',
    });

    expect(label).toBe('TONIGHT');
  });

  it('keeps promotion copy deadline-aware and exposes the overlay label', () => {
    const context = buildGenerationTemporalContext({
      contentType: 'promotion',
      brief: {
        title: 'Burger Deal',
        offerSummary: 'Two burgers for 20 pounds',
        endDate: '2026-05-27',
      },
      scheduledAt: '2026-05-27T20:00:00.000+01:00',
    });

    expect(context.timingLabel).toBe('promotion_last_day');
    expect(context.temporalInstruction).toContain('ends tonight');
    expect(context.proximityLabel).toBe('LAST DAY');
  });

  it('derives weekly overlay labels from the scheduled reference date', () => {
    const label = getCreatePreviewBannerLabel({
      contentType: 'weekly_recurring',
      brief: {
        title: 'Fish Friday',
        dayOfWeek: 5,
        time: '18:00',
      },
      scheduledAt: '2026-05-27T10:00:00.000+01:00',
    });

    expect(label).toBe('THIS FRIDAY');
  });
});
