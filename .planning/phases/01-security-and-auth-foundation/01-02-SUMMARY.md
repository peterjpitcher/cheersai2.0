---
phase: 01-security-and-auth-foundation
plan: 02
subsystem: database
tags: [postgresql, rls, migrations, supabase, schema, greenfield]

requires:
  - phase: none
    provides: "First schema plan -- no prior dependencies"
provides:
  - "Greenfield PostgreSQL schema with 16 tables across 6 domains"
  - "RLS enabled on every table with account-scoped policies"
  - "Shared enum types: content_status, content_type, platform, connection_status, notification_urgency"
  - "Reusable set_updated_at() trigger function"
  - "Token vault table with encrypted-only storage (ciphertext, iv, tag)"
  - "Publish jobs with UNIQUE idempotency_key and EXCLUDE gist constraint"
  - "Junction table pattern for content_media_attachments"
affects: [02-core-content-and-publishing, 03-platform-integrations, 04-publishing-pipeline, 05-analytics-and-link-in-bio, 06-polish-and-launch]

tech-stack:
  added: [btree_gist extension]
  patterns: [account-scoped RLS via auth.uid() subquery, junction tables instead of array columns, append-only audit log, EXCLUDE constraint for job deduplication]

key-files:
  created:
    - supabase/migrations/00000000000000_baseline.sql
    - supabase/migrations/00000000000001_content.sql
    - supabase/migrations/00000000000002_publishing.sql
    - supabase/migrations/00000000000003_notifications.sql
    - supabase/migrations/00000000000004_analytics.sql
    - supabase/migrations/00000000000005_link_in_bio.sql
  modified: []

key-decisions:
  - "RLS policies use subquery through accounts table (WHERE auth_user_id = auth.uid()) instead of JWT app_metadata for reliability"
  - "Audit log is append-only with SELECT and INSERT policies only -- no UPDATE or DELETE"
  - "Junction tables (content_media_attachments) inherit RLS through parent FK subquery"

patterns-established:
  - "Account-scoped RLS: every table has account_id, policies enforce via accounts.auth_user_id = auth.uid()"
  - "Token vault: encrypted columns only (ciphertext, iv, tag, key_version) -- no plain-text token storage"
  - "Domain migration ordering: baseline (00) then content (01), publishing (02), notifications (03), analytics (04), link-in-bio (05)"
  - "set_updated_at() trigger applied to all tables with updated_at column"

requirements-completed: [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09, DATA-10, DATA-11]

duration: 3min
completed: 2026-05-19
---

# Phase 1 Plan 2: Greenfield Schema Baseline Summary

**16-table PostgreSQL schema with RLS on every table, encrypted token vault, idempotent publish jobs, and junction-table media attachments replacing uuid[] columns**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-19T06:46:49Z
- **Completed:** 2026-05-19T06:49:58Z
- **Tasks:** 2
- **Files modified:** 64 (58 deleted, 6 created)

## Accomplishments
- Deleted all 58 v1 migration files and established clean greenfield schema baseline
- Created 6 migration files covering 16 tables across all application domains (core, content, publishing, notifications, analytics, link-in-bio)
- Enabled RLS on every table (16 total) with account-scoped policies resolving critical issue C-3
- Token vault stores only encrypted data (ciphertext/iv/tag) -- no plain-text token storage anywhere

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete v1 migrations and create baseline schema** - `7eca62d` (feat)
2. **Task 2: Domain-specific migrations** - `d7f0eef` (feat)

## Files Created/Modified
- `supabase/migrations/00000000000000_baseline.sql` - Core tables: accounts, profiles, social_connections, token_vault; shared enums; set_updated_at trigger
- `supabase/migrations/00000000000001_content.sql` - content_items, content_item_versions, media_library, content_media_attachments (junction table)
- `supabase/migrations/00000000000002_publishing.sql` - publish_jobs (idempotency_key UNIQUE, EXCLUDE gist), publish_attempts, audit_log (append-only)
- `supabase/migrations/00000000000003_notifications.sql` - notification_urgency enum, notifications table with unread partial index
- `supabase/migrations/00000000000004_analytics.sql` - analytics_snapshots, gbp_daily_metrics (schema-only for Phase 6)
- `supabase/migrations/00000000000005_link_in_bio.sql` - link_in_bio_profiles (one per account), link_in_bio_tiles (max 12 via CHECK)

## Decisions Made
- RLS policies use a subquery through the accounts table (`SELECT id FROM public.accounts WHERE auth_user_id = auth.uid()`) rather than relying on JWT app_metadata. This is more reliable as it works regardless of whether app_metadata has been configured.
- Audit log enforces append-only semantics at the RLS level: only SELECT and INSERT policies exist, preventing any row modification or deletion by the anon role.
- Junction tables that lack a direct account_id column (content_media_attachments, token_vault) inherit access control through subqueries joining to their parent tables.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. These are schema-only migrations.

## Known Stubs
None - all tables are fully defined with columns, constraints, indexes, and RLS policies. Tables in analytics and link-in-bio domains are schema-only by design (populated in later phases).

## Next Phase Readiness
- All domain tables deployed and ready for application code in subsequent plans and phases
- Token vault table ready for the crypto module (Plan 01-03)
- Content and publishing tables ready for server actions in Phase 2
- RLS pattern established for any future tables

## Self-Check: PASSED

All 7 files verified present. Both task commits (7eca62d, d7f0eef) confirmed in git history.

---
*Phase: 01-security-and-auth-foundation*
*Completed: 2026-05-19*
