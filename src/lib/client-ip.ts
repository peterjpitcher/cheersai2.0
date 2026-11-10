import 'server-only';

import net from 'node:net';

// ---------------------------------------------------------------------------
// The visitor's IP address, for rate limits and Turnstile.
//
// Vercel sets x-vercel-forwarded-for, x-forwarded-for and x-real-ip to the
// address that connected to it, overwriting anything the client sent, so a
// client cannot choose them. Behind Cloudflare's proxy that address is a
// Cloudflare edge, shared by unrelated visitors, and the visitor's own address
// arrives in cf-connecting-ip instead. We trust cf-connecting-ip only when the
// connection really came from a Cloudflare edge; otherwise anyone reaching the
// Vercel origin directly could set it and pick their own rate-limit bucket.
//
// Node runtime only (node:net). Nothing that calls this runs in the Edge
// runtime; there is no middleware or proxy in this app.
// ---------------------------------------------------------------------------

/**
 * Cloudflare's published edge ranges, fetched on 10 November 2026 from
 * https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6.
 * Cloudflare changes them rarely; re-check those pages if it announces a change.
 */
export const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
] as const;

export const CLOUDFLARE_IPV6_RANGES = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

function buildBlockList(): net.BlockList {
  const list = new net.BlockList();
  for (const range of CLOUDFLARE_IPV4_RANGES) {
    const [address, prefix] = range.split('/');
    list.addSubnet(address!, Number(prefix), 'ipv4');
  }
  for (const range of CLOUDFLARE_IPV6_RANGES) {
    const [address, prefix] = range.split('/');
    list.addSubnet(address!, Number(prefix), 'ipv6');
  }
  return list;
}

const cloudflareRanges = buildBlockList();

/** True when `ip` is a plain IPv4 or IPv6 address inside Cloudflare's edge ranges. */
export function isCloudflareIp(ip: string): boolean {
  const address = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return isCloudflareIp(mapped[1]!);
  const family = net.isIP(address);
  if (family === 4) return cloudflareRanges.check(address, 'ipv4');
  if (family === 6) return cloudflareRanges.check(address, 'ipv6');
  return false;
}

function firstValue(value: string | null): string {
  return value?.split(',')[0]?.trim() ?? '';
}

/**
 * The visitor's IP address, or null when no header carries one (never on
 * Vercel). The edge address is the first value of x-vercel-forwarded-for,
 * else x-forwarded-for, else x-real-ip, returned as given (callers decide what
 * to do with something that is not a plain IP). When that edge address is a
 * Cloudflare edge and cf-connecting-ip holds a valid IP, the visitor is
 * cf-connecting-ip instead.
 */
export function clientIp(headers: Pick<Headers, 'get'>): string | null {
  const edge =
    firstValue(headers.get('x-vercel-forwarded-for')) ||
    firstValue(headers.get('x-forwarded-for')) ||
    firstValue(headers.get('x-real-ip'));
  if (!edge) return null;

  if (isCloudflareIp(edge)) {
    const visitor = headers.get('cf-connecting-ip')?.trim() ?? '';
    if (net.isIP(visitor)) return visitor;
  }
  return edge;
}
