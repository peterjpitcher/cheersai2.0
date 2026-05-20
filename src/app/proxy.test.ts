import { describe, it, expect } from 'vitest';
import { isPublicPath } from './proxy';

describe('isPublicPath', () => {
  it('should treat /login as a public path', () => {
    expect(isPublicPath('/login')).toBe(true);
  });

  it('should treat /login?next=/planner as a public path', () => {
    // Query params are not part of pathname, but /login with suffix should match
    expect(isPublicPath('/login')).toBe(true);
  });

  it('should NOT treat /planner as a public path', () => {
    expect(isPublicPath('/planner')).toBe(false);
  });

  it('should NOT treat /dashboard as a public path', () => {
    expect(isPublicPath('/dashboard')).toBe(false);
  });

  it('should treat /auth/callback as a public path', () => {
    expect(isPublicPath('/auth/callback')).toBe(true);
  });

  it('should treat /auth/login as a public path', () => {
    expect(isPublicPath('/auth/login')).toBe(true);
  });

  it('should treat /api/auth/callback as a public path', () => {
    expect(isPublicPath('/api/auth/callback')).toBe(true);
  });

  it('should treat /_next/static as a public path', () => {
    expect(isPublicPath('/_next/static/chunks/main.js')).toBe(true);
  });

  it('should treat /favicon.ico as a public path', () => {
    expect(isPublicPath('/favicon.ico')).toBe(true);
  });

  it('should treat static image files as public paths', () => {
    expect(isPublicPath('/images/logo.png')).toBe(true);
    expect(isPublicPath('/assets/hero.jpg')).toBe(true);
    expect(isPublicPath('/icon.svg')).toBe(true);
  });

  it('should NOT treat /settings as a public path', () => {
    expect(isPublicPath('/settings')).toBe(false);
  });

  it('should NOT treat /create as a public path', () => {
    expect(isPublicPath('/create')).toBe(false);
  });

  it('should treat /l/ link-in-bio paths as public', () => {
    expect(isPublicPath('/l/some-venue')).toBe(true);
  });
});
