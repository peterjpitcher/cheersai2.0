# Project Timeline & Resourcing Assumptions

## 1. Summary
- Estimated delivery: 12 weeks across four phases, assuming 1 full-time engineer + part-time designer.
- Dependencies: Access to provider test accounts, OpenAI key, Supabase project, staging environment.

## 2. Phase Breakdown
### Phase 1 – Foundations (Weeks 1–3)
- Tasks: Project setup, auth, database schema/migrations, settings module, connections hub, media library MVP, queue infrastructure.
- Roles: Engineer (FT), Designer (PT for navigation wireframes), DevOps support for Supabase/Vercel config.

### Phase 2 – Content Workflows (Weeks 4–6)
- Tasks: Campaign/instant creation flows, AI prompt integration, unified editor, media attachment handling.
- Roles: Engineer, Designer (component refinements), QA (part-time for flow testing).

### Phase 3 – Scheduling & Publishing (Weeks 7–9)
- Tasks: Scheduling logic, drag-and-drop UI, conflict detection, queue-worker integration with provider adapters, retry/fallback mechanisms.
- Roles: Engineer, QA (integration tests), DevOps (monitoring setup).

### Phase 4 – Polish & Hardening (Weeks 10–12)
- Tasks: Story/event/offer edge cases, notifications, runbooks, load tests, UAT, launch prep.
- Roles: Engineer, Designer (UI polish), QA (UAT), Owner sign-off.

## 3. Key Milestones
- Week 3: Foundations demo (settings, media upload, connections scaffolding).
- Week 6: Content creation end-to-end demo (campaign creation through draft content).
- Week 9: Scheduling + auto-publishing demo with mock providers.
- Week 12: Production release candidate & go-live readiness review.

## 4. Resourcing Notes
- Engineering: ideally 1 principal/full-stack with experience in Next.js + integrations; optional support engineer for QA/backlog.
- Design: ~1.5 sprint weeks total for IA, editor refinements, final polish.
- QA: part-time manual tester or automated test coverage by engineer; allocate 1 week for UAT scripts.
- Ops: ensure provider API quotas and tokens set up before Phase 3.

## 5. Risks & Mitigations
- **Integration Delays**: Acquire provider approvals early; use mocks until real credentials confirmed.
- **Video Processing Complexity**: Spike early in Phase 2; consider vendor service if serverless FFmpeg insufficient.
- **Scope Creep**: Lock change requests per phase; backlog extras for post-launch.
- **Single Personnel Bottleneck**: If sole engineer unavailable, progress halts; consider backup contractor for critical path weeks.

## 6. Deliverables per Phase
- Documentation updates in `docs/rebuild/` after each phase.
- Phase exit criteria include passing lint/typecheck/tests, updated runbooks, and owner-approved demos.

## 7. Post-Launch Follow-Up
- Week 13–14: Monitor live performance, address early bugs, plan minor enhancements (e.g. prompt presets, analytics-lite).
