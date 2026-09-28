import { describe, expect, it } from 'vitest';

import { renderExistingLoginEmail, renderNewVenueOperatorEmail, renderSignupConfirmEmail } from '@/lib/signup/emails';

// Rendered from fixtures (workspace rule): fail on undefined, NaN, Invalid Date or an empty link.
const BAD_OUTPUT = /undefined|NaN|Invalid Date|href=""|null/;

describe('renderSignupConfirmEmail', () => {
  const fixture = {
    link: 'https://cheers.orangejelly.co.uk/auth/confirm?token_hash=abc123def456&type=signup&next=%2Fsignup%2Fvenue',
    signupUrl: 'https://cheers.orangejelly.co.uk/signup',
  };

  it('renders the confirmation link, escaped, with nothing missing', () => {
    const email = renderSignupConfirmEmail(fixture);
    expect(email.subject).toBe('Confirm your email to start your Cheers trial');
    expect(email.html).toContain(
      'href="https://cheers.orangejelly.co.uk/auth/confirm?token_hash=abc123def456&amp;type=signup&amp;next=%2Fsignup%2Fvenue"',
    );
    expect(email.html).toContain('https://cheers.orangejelly.co.uk/signup');
    expect(email.html).toContain('deleted after 7 days');
    expect(email.html).not.toMatch(BAD_OUTPUT);
  });

  it('promises no link lifetime: Supabase sets it (one hour or less in production)', () => {
    const email = renderSignupConfirmEmail(fixture);
    expect(email.html).toContain('This link works once and only for a short time. If it has expired, ask for a new one at');
    expect(email.html).not.toMatch(/expires in|\bhours?\b|\bminutes?\b/i);
  });

  it('refuses to render without a link', () => {
    expect(() => renderSignupConfirmEmail({ ...fixture, link: '' })).toThrow();
    expect(() => renderSignupConfirmEmail({ ...fixture, signupUrl: '' })).toThrow();
  });
});

describe('renderExistingLoginEmail', () => {
  const fixture = {
    loginUrl: 'https://cheers.orangejelly.co.uk/login',
    resetUrl: 'https://cheers.orangejelly.co.uk/forgot-password',
    contactEmail: 'peter@orangejelly.co.uk',
  };

  it('offers sign-in and reset links and the contact address, and no one-time link', () => {
    const email = renderExistingLoginEmail(fixture);
    expect(email.subject).toBe('You already have a Cheers login');
    expect(email.html).toContain('href="https://cheers.orangejelly.co.uk/login"');
    expect(email.html).toContain('href="https://cheers.orangejelly.co.uk/forgot-password"');
    expect(email.html).toContain('mailto:peter@orangejelly.co.uk');
    expect(email.html).not.toContain('token_hash');
    expect(email.html).not.toMatch(BAD_OUTPUT);
  });

  it('refuses to render with anything missing', () => {
    expect(() => renderExistingLoginEmail({ ...fixture, loginUrl: '' })).toThrow();
    expect(() => renderExistingLoginEmail({ ...fixture, resetUrl: '' })).toThrow();
    expect(() => renderExistingLoginEmail({ ...fixture, contactEmail: '' })).toThrow();
  });
});

describe('renderNewVenueOperatorEmail', () => {
  const fixture = {
    venueName: 'Fish & Chips <Co>',
    venueTypeLabel: 'Other hospitality venue',
    signupEmail: 'owner@venue.test',
    // 13:05 UTC on the clock-change Sunday is 13:05 GMT; the day before it was BST.
    createdAt: new Date('2026-10-25T13:05:00Z'),
    accountId: '22222222-2222-4222-8222-222222222222',
    adminUrl: 'https://cheers.orangejelly.co.uk/admin',
  };

  it('renders the venue, type, sign-up email, UK time and brand id, escaped, with the name kept out of the subject', () => {
    const email = renderNewVenueOperatorEmail(fixture);
    expect(email.subject).toBe('[Cheers operator] New self-serve venue');
    expect(email.html).toContain('Venue: <strong>Fish &amp; Chips &lt;Co&gt;</strong>');
    expect(email.html).toContain('Type: Other hospitality venue');
    expect(email.html).toContain('Sign-up email: owner@venue.test');
    expect(email.html).toContain('Created: 25/10/2026, 13:05:00 (UK time)');
    expect(email.html).toContain('Brand id: 22222222-2222-4222-8222-222222222222');
    expect(email.html).toContain('href="https://cheers.orangejelly.co.uk/admin"');
    expect(email.html).not.toMatch(BAD_OUTPUT);
  });

  it('shows British Summer Time in the summer', () => {
    const email = renderNewVenueOperatorEmail({ ...fixture, createdAt: new Date('2026-09-28T13:05:00Z') });
    expect(email.html).toContain('Created: 28/09/2026, 14:05:00 (UK time)');
  });

  it('refuses to render with anything missing or an invalid time', () => {
    expect(() => renderNewVenueOperatorEmail({ ...fixture, venueName: ' ' })).toThrow(/venue name/);
    expect(() => renderNewVenueOperatorEmail({ ...fixture, signupEmail: '' })).toThrow(/sign-up email/);
    expect(() => renderNewVenueOperatorEmail({ ...fixture, accountId: '' })).toThrow(/brand id/);
    expect(() => renderNewVenueOperatorEmail({ ...fixture, adminUrl: '' })).toThrow(/admin link/);
    expect(() => renderNewVenueOperatorEmail({ ...fixture, createdAt: new Date('nope') })).toThrow(/valid time/);
  });
});
