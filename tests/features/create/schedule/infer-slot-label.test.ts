import { describe, it, expect } from 'vitest';
import { inferSlotLabel } from '@/features/create/schedule/infer-slot-label';

describe('inferSlotLabel', () => {
  it('returns "Event day" for event date match', () => {
    const label = inferSlotLabel(
      { contentType: 'event', eventDate: '2026-06-15' },
      '2026-06-15',
    );
    expect(label).toBe('Event day');
  });

  it('returns "Last chance" for promotion end date match', () => {
    const label = inferSlotLabel(
      { contentType: 'promotion', endDate: '2026-06-30' },
      '2026-06-30',
    );
    expect(label).toBe('Last chance');
  });

  it('returns undefined for non-matching date', () => {
    const label = inferSlotLabel(
      { contentType: 'event', eventDate: '2026-06-15' },
      '2026-06-14',
    );
    expect(label).toBeUndefined();
  });

  it('returns undefined for instant_post', () => {
    const label = inferSlotLabel(
      { contentType: 'instant_post' },
      '2026-06-15',
    );
    expect(label).toBeUndefined();
  });

  it('returns undefined when event has no eventDate', () => {
    const label = inferSlotLabel(
      { contentType: 'event' },
      '2026-06-15',
    );
    expect(label).toBeUndefined();
  });

  it('returns undefined when promotion has no endDate', () => {
    const label = inferSlotLabel(
      { contentType: 'promotion' },
      '2026-06-30',
    );
    expect(label).toBeUndefined();
  });
});
