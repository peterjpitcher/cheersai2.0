import { sortByDate } from "../lib/sortByDate";

describe('sortByDate', () => {
  it('sorts by scheduled_for ascending with strings', () => {
    const items = [
      { scheduled_for: '2025-01-01T10:00:00Z' },
      { scheduled_for: '2025-01-01T08:00:00Z' },
      { scheduled_for: '2025-01-01T09:00:00Z' },
    ];
    const sorted = [...items].sort(sortByDate);
    expect(sorted.map(i => i.scheduled_for)).toEqual([
      '2025-01-01T08:00:00Z',
      '2025-01-01T09:00:00Z',
      '2025-01-01T10:00:00Z',
    ]);
  });

  it('handles Date objects and null/undefined', () => {
    const items = [
      { scheduled_for: null as any },
      { scheduled_for: new Date('2025-01-01T08:00:00Z') },
      { scheduled_for: undefined },
      { scheduled_for: new Date('2025-01-01T07:00:00Z') },
    ];
    const sorted = [...items].sort(sortByDate);
    expect(sorted[0].scheduled_for).toBeNull();
    expect(sorted[1].scheduled_for).toBeUndefined();
    expect(sorted[2].scheduled_for instanceof Date).toBe(true);
  });
});

