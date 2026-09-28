import { describe, expect, it } from 'vitest';

import { renderExistingLoginEmail, renderSignupConfirmEmail } from '@/lib/signup/emails';

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
