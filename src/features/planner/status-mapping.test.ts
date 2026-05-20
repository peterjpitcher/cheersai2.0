import { describe, it, expect } from 'vitest';
import { toDesignStatus as calendarToDesignStatus } from './calendar-cell';
import { toDesignStatus as agendaToDesignStatus } from './planner-agenda';

describe('calendar-cell toDesignStatus', () => {
  it('maps "posted" to the same result as "published"', () => {
    expect(calendarToDesignStatus('posted')).toBe(calendarToDesignStatus('published'));
    expect(calendarToDesignStatus('posted')).toBe('posted');
  });

  it('maps "published" to "posted"', () => {
    expect(calendarToDesignStatus('published')).toBe('posted');
  });

  it('maps "draft" to "draft"', () => {
    expect(calendarToDesignStatus('draft')).toBe('draft');
  });

  it('maps "scheduled" to "scheduled"', () => {
    expect(calendarToDesignStatus('scheduled')).toBe('scheduled');
  });

  it('maps "failed" to "failed"', () => {
    expect(calendarToDesignStatus('failed')).toBe('failed');
  });

  it('maps "publishing" to "publishing"', () => {
    expect(calendarToDesignStatus('publishing')).toBe('publishing');
  });

  it('maps "queued" to "publishing"', () => {
    expect(calendarToDesignStatus('queued')).toBe('publishing');
  });

  it('maps unknown status to "draft" as fallback', () => {
    expect(calendarToDesignStatus('unknown_value')).toBe('draft');
  });
});

describe('planner-agenda toDesignStatus', () => {
  it('maps "posted" to the same result as "published"', () => {
    expect(agendaToDesignStatus('posted')).toBe(agendaToDesignStatus('published'));
    expect(agendaToDesignStatus('posted')).toBe('posted');
  });

  it('maps "published" to "posted"', () => {
    expect(agendaToDesignStatus('published')).toBe('posted');
  });

  it('maps "draft" to "draft"', () => {
    expect(agendaToDesignStatus('draft')).toBe('draft');
  });

  it('maps "scheduled" to "scheduled"', () => {
    expect(agendaToDesignStatus('scheduled')).toBe('scheduled');
  });

  it('maps "failed" to "failed"', () => {
    expect(agendaToDesignStatus('failed')).toBe('failed');
  });
});
