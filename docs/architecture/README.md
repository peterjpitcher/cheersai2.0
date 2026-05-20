---
generated: true
last_updated: 2026-05-20T00:00:00Z
source: session-setup
project: cheersai-app
---

# Architecture Docs

Auto-generated reference for CheersAI 2.0. Regenerated on each `session-setup` run. Do not edit these files directly -- they will be overwritten. Use `docs/architecture/NOTES.md` for persistent notes.

## Files

| File | Contents |
|------|----------|
| [overview.md](overview.md) | System summary, tech stack, auth model, background jobs, cron jobs |
| [routes.md](routes.md) | All pages (22), API routes (25), middleware config |
| [server-actions.md](server-actions.md) | All server actions (~100) with auth and table mapping |
| [data-model.md](data-model.md) | 16 database tables with inferred columns and relationships |
| [relationships.md](relationships.md) | Table relationships, domain flows, external integration map |

## Scan Summary

| Metric | Count |
|--------|-------|
| Pages | 22 |
| API routes | 25 |
| Cron jobs | 11 |
| Server action files | 24 |
| Exported actions | ~100 |
| Database tables | 16 |
| External integrations | 7 (OpenAI, Resend, QStash, Redis, Meta, GBP, Supabase) |
| Environment variables | ~35 (20 server, 5 client, ~10 feature/debug) |

## Auth Model

- Middleware: domain redirect only (no auth)
- Layout-level: `getCurrentUser()` in `(app)` group
- Server actions: `requireAuthContext()` returns `{ supabase, accountId }`
- Rate limiting: Upstash Redis sliding window on auth endpoints
- Audit logging: not currently implemented

## Last Scan

2026-05-20 via session-setup enrichment scanner.
