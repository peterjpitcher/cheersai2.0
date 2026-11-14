import { describe, expect, it } from 'vitest';

import { eventEndFromDuration, resolveEventEnd } from '@/lib/scheduling/event-end';

describe('resolveEventEnd', () => {
  it('resolves a same-day end', () => {
    const result = resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00', endTime: '22:30' });
    expect(result).toMatchObject({
      ok: true,
      startDate: '2026-12-04',
      startTime: '19:00',
      endDate: '2026-12-04',
      endTime: '22:30',
      start: '2026-12-04T19:00:00.000+00:00',
      end: '2026-12-04T22:30:00.000+00:00',
    });
  });

  it('rolls an overnight end to the next day', () => {
    const result = resolveEventEnd({ startDate: '2026-12-31', startTime: '20:00', endTime: '01:00' });
    expect(result).toMatchObject({ ok: true, endDate: '2027-01-01', endTime: '01:00' });
  });

  it('treats 00:00 as midnight at the end of the start day', () => {
    const result = resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00', endTime: '00:00' });
    expect(result).toMatchObject({ ok: true, endDate: '2026-12-05', endTime: '00:00' });
  });

  it('rolls an end equal to the start to the next day', () => {
    const result = resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00', endTime: '19:00' });
    expect(result).toMatchObject({ ok: true, endDate: '2026-12-05' });
  });

  it('rolls an end date equal to the start date too', () => {
    const result = resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00', endDate: '2026-12-04', endTime: '00:30' });
    expect(result).toMatchObject({ ok: true, endDate: '2026-12-05', endTime: '00:30' });
  });

  it('uses an explicit later end date', () => {
    const result = resolveEventEnd({ startDate: '2026-12-04', startTime: '12:00', endDate: '2026-12-06', endTime: '17:00' });
    expect(result).toMatchObject({ ok: true, endDate: '2026-12-06', endTime: '17:00' });
  });

  it('is not eligible without a start', () => {
    expect(resolveEventEnd({ startDate: '2026-12-04', endTime: '22:00' })).toEqual({ ok: false, reason: 'missing_start' });
    expect(resolveEventEnd({ startTime: '19:00', endTime: '22:00' })).toEqual({ ok: false, reason: 'missing_start' });
    expect(resolveEventEnd({ startDate: 'tomorrow', startTime: '19:00', endTime: '22:00' })).toEqual({ ok: false, reason: 'missing_start' });
  });

  it('is not eligible without an end time, and never guesses one', () => {
    expect(resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00' })).toEqual({ ok: false, reason: 'missing_end_time' });
    expect(resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00', endTime: '' })).toEqual({ ok: false, reason: 'missing_end_time' });
  });

  it('is not eligible for a multi-day event with no end time', () => {
    expect(resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00', endDate: '2026-12-06' })).toEqual({
      ok: false,
      reason: 'missing_end_time',
    });
  });

  it('rejects a malformed end time', () => {
    expect(resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00', endTime: '25:00' })).toEqual({
      ok: false,
      reason: 'invalid_end_time',
    });
  });

  it('rejects an end date before the start date', () => {
    expect(resolveEventEnd({ startDate: '2026-12-04', startTime: '19:00', endDate: '2026-12-03', endTime: '22:00' })).toEqual({
      ok: false,
      reason: 'end_before_start',
    });
  });

  describe('clocks going back, 25 October 2026 (01:00 to 02:00 happens twice)', () => {
    it('keeps the real length of an event that spans the change', () => {
      const result = resolveEventEnd({ startDate: '2026-10-24', startTime: '22:00', endTime: '03:00' });
      expect(result).toMatchObject({
        ok: true,
        endDate: '2026-10-25',
        endTime: '03:00',
        start: '2026-10-24T22:00:00.000+01:00',
        end: '2026-10-25T03:00:00.000+00:00',
      });
    });

    it('takes the first (BST) occurrence of a repeated time', () => {
      const end = resolveEventEnd({ startDate: '2026-10-24', startTime: '22:00', endTime: '01:30' });
      expect(end).toMatchObject({ ok: true, endDate: '2026-10-25', endTime: '01:30', end: '2026-10-25T01:30:00.000+01:00' });

      const start = resolveEventEnd({ startDate: '2026-10-25', startTime: '01:30', endTime: '04:00' });
      expect(start).toMatchObject({ ok: true, start: '2026-10-25T01:30:00.000+01:00' });
    });
  });

  describe('clocks going forward, 28 March 2027 (01:00 to 02:00 does not exist)', () => {
    it('is not eligible when the start is in the gap', () => {
      expect(resolveEventEnd({ startDate: '2027-03-28', startTime: '01:30', endTime: '04:00' })).toEqual({
        ok: false,
        reason: 'start_in_clock_change_gap',
      });
    });

    it('is not eligible when the end is in the gap', () => {
      expect(resolveEventEnd({ startDate: '2027-03-27', startTime: '22:00', endTime: '01:30' })).toEqual({
        ok: false,
        reason: 'end_in_clock_change_gap',
      });
    });

    it('rolls an overnight end to the next day before checking for the gap', () => {
      // Starts the evening AFTER the clocks went forward: 01:30 the next morning is a real time.
      const result = resolveEventEnd({ startDate: '2027-03-28', startTime: '22:00', endTime: '01:30' });
      expect(result).toMatchObject({
        ok: true,
        endDate: '2027-03-29',
        endTime: '01:30',
        end: '2027-03-29T01:30:00.000+01:00',
      });
    });

    it('still refuses an end that really falls in the gap, with or without an end date', () => {
      expect(resolveEventEnd({ startDate: '2027-03-27', startTime: '22:00', endDate: '2027-03-28', endTime: '01:30' })).toEqual({
        ok: false,
        reason: 'end_in_clock_change_gap',
      });
      expect(resolveEventEnd({ startDate: '2027-03-28', startTime: '00:30', endTime: '01:30' })).toEqual({
        ok: false,
        reason: 'end_in_clock_change_gap',
      });
    });

    it('resolves an event that spans the change', () => {
      const result = resolveEventEnd({ startDate: '2027-03-27', startTime: '22:00', endTime: '03:00' });
      expect(result).toMatchObject({
        ok: true,
        endDate: '2027-03-28',
        start: '2027-03-27T22:00:00.000+00:00',
        end: '2027-03-28T03:00:00.000+01:00',
      });
    });
  });
});

describe('eventEndFromDuration', () => {
  it('adds the duration to the start', () => {
    expect(eventEndFromDuration({ startDate: '2026-12-04', startTime: '19:00', durationMinutes: 150 })).toEqual({ endTime: '21:30' });
  });

  it('gives an overnight end with no end date, since the form rolls it over', () => {
    expect(eventEndFromDuration({ startDate: '2026-12-04', startTime: '21:00', durationMinutes: 240 })).toEqual({ endTime: '01:00' });
  });

  it('gives an end date for an event of a day or longer', () => {
    expect(eventEndFromDuration({ startDate: '2026-12-04', startTime: '12:00', durationMinutes: 1560 })).toEqual({
      endTime: '14:00',
      endDate: '2026-12-05',
    });
  });

  it('counts real minutes across a clock change', () => {
    // 22:00 BST plus 4 hours is 01:00 GMT on the morning the clocks go back.
    expect(eventEndFromDuration({ startDate: '2026-10-24', startTime: '22:00', durationMinutes: 240 })).toEqual({ endTime: '01:00' });
  });

  it('returns nothing for a missing, zero, negative or invalid duration', () => {
    const start = { startDate: '2026-12-04', startTime: '19:00' };
    expect(eventEndFromDuration({ ...start })).toBeNull();
    expect(eventEndFromDuration({ ...start, durationMinutes: null })).toBeNull();
    expect(eventEndFromDuration({ ...start, durationMinutes: 0 })).toBeNull();
    expect(eventEndFromDuration({ ...start, durationMinutes: -30 })).toBeNull();
    expect(eventEndFromDuration({ ...start, durationMinutes: Number.NaN })).toBeNull();
  });

  it('returns nothing without a usable start', () => {
    expect(eventEndFromDuration({ startDate: '2026-12-04', durationMinutes: 60 })).toBeNull();
  });
});
