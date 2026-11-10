import { describe, expect, it } from 'vitest';

import { clientIp, isCloudflareIp } from '@/lib/client-ip';

// 104.16.0.1 and 2606:4700::1 sit inside Cloudflare's published edge ranges.
const CF_EDGE_V4 = '104.16.0.1';
const CF_EDGE_V6 = '2606:4700::1';

describe('isCloudflareIp', () => {
  it('matches addresses inside the published IPv4 and IPv6 ranges', () => {
    expect(isCloudflareIp(CF_EDGE_V4)).toBe(true);
    expect(isCloudflareIp('172.71.255.255')).toBe(true);
    expect(isCloudflareIp(CF_EDGE_V6)).toBe(true);
    expect(isCloudflareIp('2a06:98c7:ffff::1')).toBe(true);
    expect(isCloudflareIp(`::ffff:${CF_EDGE_V4}`)).toBe(true);
  });

  it('does not match other addresses or non-addresses', () => {
    expect(isCloudflareIp('203.0.113.7')).toBe(false);
    expect(isCloudflareIp('104.32.0.1')).toBe(false);
    expect(isCloudflareIp('2001:db8::1')).toBe(false);
    expect(isCloudflareIp('unknown')).toBe(false);
    expect(isCloudflareIp('')).toBe(false);
  });
});

describe('clientIp', () => {
  it('returns cf-connecting-ip (IPv4) when Vercel saw a Cloudflare IPv4 edge', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': CF_EDGE_V4,
      'x-forwarded-for': CF_EDGE_V4,
      'x-real-ip': CF_EDGE_V4,
      'cf-connecting-ip': '203.0.113.7',
    });
    expect(clientIp(headers)).toBe('203.0.113.7');
  });

  it('returns cf-connecting-ip (IPv6) when Vercel saw a Cloudflare IPv6 edge', () => {
    const headers = new Headers({ 'x-vercel-forwarded-for': CF_EDGE_V6, 'cf-connecting-ip': '2001:db8:1:2::7' });
    expect(clientIp(headers)).toBe('2001:db8:1:2::7');
  });

  it('returns an IPv6 visitor behind an IPv4 edge, and the reverse', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': CF_EDGE_V4, 'cf-connecting-ip': '2001:db8::7' }))).toBe('2001:db8::7');
    expect(clientIp(new Headers({ 'x-real-ip': CF_EDGE_V6, 'cf-connecting-ip': '198.51.100.2' }))).toBe('198.51.100.2');
  });

  it('ignores a forged cf-connecting-ip when the edge address is not Cloudflare', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '198.51.100.2',
      'x-forwarded-for': '198.51.100.2',
      'cf-connecting-ip': '203.0.113.7',
    });
    expect(clientIp(headers)).toBe('198.51.100.2');
  });

  it('falls back to the edge address when cf-connecting-ip is missing or not an IP', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': CF_EDGE_V4 }))).toBe(CF_EDGE_V4);
    expect(clientIp(new Headers({ 'x-forwarded-for': CF_EDGE_V4, 'cf-connecting-ip': 'unknown' }))).toBe(CF_EDGE_V4);
    expect(clientIp(new Headers({ 'x-forwarded-for': CF_EDGE_V4, 'cf-connecting-ip': '203.0.113.7, 10.0.0.1' }))).toBe(
      CF_EDGE_V4,
    );
    expect(clientIp(new Headers({ 'x-forwarded-for': CF_EDGE_V4, 'cf-connecting-ip': '  ' }))).toBe(CF_EDGE_V4);
  });

  it('prefers x-vercel-forwarded-for, then x-forwarded-for, then x-real-ip, taking the first entry', () => {
    expect(
      clientIp(new Headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '198.51.100.2', 'x-real-ip': '192.0.2.1' })),
    ).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1', 'x-real-ip': '192.0.2.1' }))).toBe('198.51.100.2');
    expect(clientIp(new Headers({ 'x-real-ip': '192.0.2.1' }))).toBe('192.0.2.1');
  });

  it('returns null with no address headers, even if cf-connecting-ip is set', () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.7' }))).toBeNull();
  });
});
