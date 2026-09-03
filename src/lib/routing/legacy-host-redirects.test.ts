import { describe, it, expect } from 'vitest';

import { legacyHostRedirects } from './legacy-host-redirects';

describe('legacyHostRedirects', () => {
  it('covers both retired hostnames', () => {
    const hosts = legacyHostRedirects.map((r) => r.has[0].value);
    expect(hosts).toEqual(['www.cheersai.uk', 'cheersai.uk']);
  });

  it('matches every path', () => {
    for (const rule of legacyHostRedirects) {
      expect(rule.source).toBe('/:path*');
    }
  });

  it('preserves the path in the destination', () => {
    for (const rule of legacyHostRedirects) {
      expect(rule.destination).toBe('https://cheers.orangejelly.co.uk/:path*');
    }
  });

  it('declares no query string, so Next forwards the incoming one', () => {
    for (const rule of legacyHostRedirects) {
      expect(rule.destination).not.toContain('?');
    }
  });

  it('is temporary, not permanent', () => {
    // A permanent redirect is cached by clients and would defeat rollback while
    // the migration is still inside its observation window.
    for (const rule of legacyHostRedirects) {
      expect(rule.permanent).toBe(false);
    }
  });

  it('only ever matches on host, never on path or header', () => {
    for (const rule of legacyHostRedirects) {
      expect(rule.has).toHaveLength(1);
      expect(rule.has[0].type).toBe('host');
    }
  });

  it('never targets the retired domain', () => {
    for (const rule of legacyHostRedirects) {
      expect(rule.destination).not.toContain('cheersai.uk');
    }
  });
});
