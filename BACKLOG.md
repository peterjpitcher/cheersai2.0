# CheersAI Rebuild Backlog (Active Items)

## Connection Onboarding
- [x] Exchange OAuth auth codes for long-lived tokens and persist them per provider.
- [x] Convert Facebook/Instagram user tokens into page/business tokens and store required metadata (`pageId`, `igBusinessId`).
- [x] Add admin view to inspect raw provider tokens + metadata for troubleshooting.
- [x] Backfill `pageId`, `igBusinessId`, and `locationId` for existing connections in production data.
- [x] Implement automated state cleanup for stale entries in `oauth_states`.

## Publish Pipeline QA
- [ ] Add unit/integration coverage for publish worker success/failure paths (metadata missing, auth failure, retry backoff).
- [ ] Provide mockable provider adapters for Vitest so edge logic can be regression tested locally.
- [ ] Capture provider response payload snapshots for inspection in the Planner detail view.
- [ ] Add end-to-end coverage for `materialise-weekly` inserts/notifications (helper utilities now covered via unit tests).
- [x] Cover connection diagnostics + OAuth completion flows in unit tests to guard metadata regressions.

## Media Pipeline Enhancements
- [x] Extend `media-derivatives` function to support video derivatives or skip gracefully with alerts.
- [ ] Add retry/backoff for derivative failures and surface status/toasts in the Library UI.
- [ ] Generate manual fallback packages (zip with assets + copy) for manual publishing when automation fails.

## Notifications & Planner UX
- [ ] Surface notifications feed or toast history within the Planner so alerts persist beyond the ephemeral tray.
- [ ] Add optimistic toasts + error states to publish-failure remediation flows.
- [ ] Extend planner feed to highlight `connection_metadata_updated` entries (currently shows raw message only).
- [ ] Persist export/download tooling for historical notifications beyond the latest 50 entries.

## Scheduler & Ops
- [x] Supabase Scheduler jobs (publish-queue, materialise-weekly, media-derivatives) managed via `supabase/config.toml` and `supabase config push`.
- [ ] Add monitoring/alerting for Edge function failures (Supabase logs + Resend alerts).
- [x] Provide scripts for on-demand retries (`supabase functions invoke publish-queue`, etc.) in the runbook.

## Documentation & Tooling
- [ ] Expand runbook with OAuth reconnect walkthroughs and token troubleshooting.
- [ ] Add sequence diagrams for publish + weekly materialisation flows (`sequence-flows.md`).
- [ ] Configure CI pipeline (lint, test, build, Supabase migration check) and document the workflow.
