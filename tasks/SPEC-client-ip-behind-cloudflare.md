# SPEC: read the visitor's IP correctly behind Cloudflare's proxy

10 November 2026. Approved by Peter.

## Why

cheers.orangejelly.co.uk is about to go behind Cloudflare's proxy (orange cloud). Once proxied, Vercel sets `x-vercel-forwarded-for`, `x-forwarded-for` and `x-real-ip` to the address that connected to it, which is a Cloudflare edge address shared by unrelated visitors. The visitor's own address arrives in `cf-connecting-ip`.

The app read `x-forwarded-for` for the auth rate limits, the Turnstile `remoteip` and the in-memory route limits (tournament feed, event-artwork import). Behind Cloudflare, every visitor through one edge would share a rate-limit bucket (real people locked out of sign-in and sign-up) and siteverify would get Cloudflare's address.

## What changes

- New `src/lib/client-ip.ts`: `clientIp(headers)` takes the edge address Vercel saw (first value of `x-vercel-forwarded-for`, else `x-forwarded-for`, else `x-real-ip`). If that address is inside Cloudflare's published ranges (dated in the file) and `cf-connecting-ip` is a valid IP, it returns `cf-connecting-ip`; otherwise the edge address. A client reaching the Vercel origin directly cannot forge `cf-connecting-ip`, because its own address is not a Cloudflare edge.
- `clientIpFromHeaders` (auth rate limits), `turnstileRemoteIp` (Turnstile) and `getRateLimitKey` (in-memory route limits) all call it. Their fallbacks are unchanged: `unknown`, null, and the user-agent hash.
- `getRateLimitKey` no longer reads `cf-connecting-ip` or `x-client-ip` on their own, since either could be set by a client.

## Order of deployment

This must be live in production before the Cloudflare proxy is switched on. It changes nothing while the site is not proxied, because no Vercel edge address is a Cloudflare address.

## Rollback

Revert the PR. Before the proxy is on, that is harmless. After it is on, switch the proxy off (grey cloud) first, or sign-in and sign-up limits fall back to one bucket per Cloudflare edge.

## Not covered

- Cloudflare's ranges are a snapshot. If Cloudflare adds a range, visitors through it are counted by the edge address until the list is updated (safe, but coarser).
- Nothing here runs in the Edge runtime: there is no middleware or proxy, and every caller is a Node server action or route.
