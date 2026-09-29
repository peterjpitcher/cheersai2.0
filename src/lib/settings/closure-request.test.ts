import { describe, expect, it } from 'vitest';

import { PURGE_AFTER_DAYS } from '@/lib/admin/offboarding';
import { renderClosureConfirmationEmail, renderClosureRequestOperatorEmail } from '@/lib/settings/closure-request';
import { CLOSED_VENUE_KEPT_DAYS, CLOSURE_STEPS, OWNER_DATA_MESSAGES } from '@/lib/settings/owner-data';

// Rendered from fixtures (workspace rule): fail on undefined, NaN, Invalid Date, null or an empty link.
const BAD_OUTPUT = /undefined|NaN|Invalid Date|href=""|null/;

// 12:30 UTC the day before the clocks go back is 13:30 BST; the day after it is 12:30 GMT.
const BST = new Date('2026-10-24T12:30:00Z');
const GMT = new Date('2026-10-26T12:30:00Z');

describe('renderClosureRequestOperatorEmail', () => {
  const fixture = {
    venueName: 'Fish & Chips <Co>',
    accountId: '11111111-1111-4111-8111-111111111111',
    ownerEmail: 'owner@venue.test',
    requestedAt: BST,
    adminUrl: 'https://cheers.orangejelly.co.uk/admin',
  };

  it('gives the operator the venue, brand id, who asked and when, in UK time, escaped', () => {
    const email = renderClosureRequestOperatorEmail(fixture);
    expect(email.subject).toBe('[Cheers operator] Request to close a venue');
    expect(email.subject).not.toContain('Fish');
    expect(email.html).toContain('Fish &amp; Chips &lt;Co&gt;');
    expect(email.html).toContain('11111111-1111-4111-8111-111111111111');
    expect(email.html).toContain('owner@venue.test');
    expect(email.html).toContain('24/10/2026, 13:30:00 (UK time)');
    expect(email.html).toContain('href="https://cheers.orangejelly.co.uk/admin"');
    expect(email.html).toContain('Nothing has been stopped or deleted yet');
    expect(email.html).toContain('30 days after offboarding');
    expect(email.html).not.toMatch(BAD_OUTPUT);
    expect(renderClosureRequestOperatorEmail({ ...fixture, requestedAt: GMT }).html).toContain('26/10/2026, 12:30:00 (UK time)');
  });

  it('refuses to render with anything missing or an invalid time', () => {
    expect(() => renderClosureRequestOperatorEmail({ ...fixture, venueName: ' ' })).toThrow();
    expect(() => renderClosureRequestOperatorEmail({ ...fixture, accountId: '' })).toThrow();
    expect(() => renderClosureRequestOperatorEmail({ ...fixture, ownerEmail: '' })).toThrow();
    expect(() => renderClosureRequestOperatorEmail({ ...fixture, adminUrl: '' })).toThrow();
    expect(() => renderClosureRequestOperatorEmail({ ...fixture, requestedAt: new Date('not a date') })).toThrow(/valid time/);
  });
});

describe('renderClosureConfirmationEmail', () => {
  const fixture = { venueName: 'The Test Arms', requestedAt: GMT, contactEmail: 'peter@orangejelly.co.uk' };

  it('tells the owner what happens next, the 30-day deletion and how to change their mind', () => {
    const email = renderClosureConfirmationEmail(fixture);
    expect(email.subject).toBe('We have your request to close your venue on Cheers');
    expect(email.html).toContain('<strong>The Test Arms</strong>');
    expect(email.html).toContain('26/10/2026, 12:30:00 (UK time)');
    expect(email.html).toContain('Nothing has changed yet');
    expect(email.html.match(/<li>/g)).toHaveLength(CLOSURE_STEPS.length);
    expect(email.html).toContain('We cancel your Cheers subscription');
    expect(email.html).toContain('30 days after closing it');
    expect(email.html).toContain('href="mailto:peter@orangejelly.co.uk"');
    expect(email.html).not.toMatch(BAD_OUTPUT);
  });

  it('refuses to render with anything missing or an invalid time', () => {
    expect(() => renderClosureConfirmationEmail({ ...fixture, venueName: '' })).toThrow();
    expect(() => renderClosureConfirmationEmail({ ...fixture, contactEmail: '' })).toThrow();
    expect(() => renderClosureConfirmationEmail({ ...fixture, requestedAt: new Date(Number.NaN) })).toThrow(/valid time/);
  });
});

describe('owner data wording', () => {
  it("keeps the owner's 30 days in step with the offboarding code (decision D5)", () => {
    expect(CLOSED_VENUE_KEPT_DAYS).toBe(PURGE_AFTER_DAYS);
  });

  it('rounds the export wait up to whole hours, never zero', () => {
    expect(OWNER_DATA_MESSAGES.exportLimited(1)).toContain('try again in 1 hour,');
    expect(OWNER_DATA_MESSAGES.exportLimited(3601)).toContain('try again in 2 hours,');
    expect(OWNER_DATA_MESSAGES.exportLimited(86400)).toContain('try again in 24 hours,');
  });

  it('uses no em dashes', () => {
    const emDash = String.fromCharCode(0x2014);
    const text = [...CLOSURE_STEPS, ...Object.values(OWNER_DATA_MESSAGES).filter((value) => typeof value === 'string')].join(' ');
    expect(text).not.toContain(emDash);
  });
});
