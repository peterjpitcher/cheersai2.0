# Claude Hand-Off Brief: Tournament Content Spec Revision

**Generated:** 2026-05-09
**Review mode:** A (Adversarial)
**Overall risk:** High (9 critical findings, all spec-level — no code to break yet)

## DO NOT REWRITE

- Two-table data model (tournaments + tournament_fixtures) — structure is sound
- Overlay renderer separation from banner system
- Satori + Sharp rendering pipeline
- Content routing through existing content_items → publish_jobs
- RLS on both tables, account-scoped
- UTC storage with Europe/London display
- Unique constraints on (account_id, slug) and (tournament_id, match_number)
- Tournament management UI route structure and fixture table design
- Approved overlay visual design (classic centre stack, supersized)

## SPEC REVISION REQUIRED

- [ ] **CR-1:** Add generation transaction boundary — all writes (media_assets, content_items, content_variants, publish_jobs, content_generated flag) must be atomic. Specify rollback/cleanup on partial failure. Add unique constraint strategy per (fixture_id, platform, placement).
- [ ] **CR-2:** Replace hardcoded 4-item generation with dynamic iteration over `tournament.platforms × [feed, story]`. Document that platforms field controls what gets generated.
- [ ] **CR-3:** Add tournament-level preconditions to all generation paths: `status = 'active'`, both base images non-null, `post_template` non-empty, at least one platform.
- [ ] **CR-4:** Regeneration must skip already-published (platform, placement) combinations. Only generate content for placements that haven't been published yet.
- [ ] **CR-5:** Define media ownership — tag generated assets with fixture source in metadata. Deletion must verify no remaining content_variants reference the asset. Consider 1 asset per content item instead of 2 shared assets.
- [ ] **CR-6:** Add explicit requirement: all tournament server actions call `getUser()` and verify account membership before any mutation.
- [ ] **CR-7:** All content lookup/deletion queries must include `account_id = tournament.account_id` alongside the fixture metadata filter.
- [ ] **CR-8:** Add `tournament.status = 'active'` to trigger conditions for all generation paths.
- [ ] **CR-9:** Add preflight step: run existing preflight validation per content item before creating publish jobs. Surface failures as blocked status in fixture table.
- [ ] **ID-1:** Stagger rule: sort simultaneous fixtures by match_number, offset by `index × 5 minutes`. Recompute on bulk generation and kick-off changes.
- [ ] **ID-2:** Replace auto-generation on inline edit with explicit "Save & Generate" action. Inline edits are draft until saved.
- [ ] **ID-3:** Past scheduled times: warn user and require confirmation before queuing if `scheduled_for` is in the past.
- [ ] **ID-4:** Lead hours changes: apply to future generation only (don't cascade to existing content). Document this explicitly.
- [ ] **SDR-1:** Validate `booking_url` is `https://` on save. Reject other protocols.
- [ ] **SDR-2:** Add max lengths: team names 50 chars, house rules 200 chars, post template 500 chars.
- [ ] **SDR-3:** Debounce bulk generate in UI + server-side lock to prevent concurrent bulk runs per tournament.

## ASSUMPTIONS TO RESOLVE

- [ ] **AB-008/ARCH-003:** Verify existing `content_items`, `content_variants`, `publish_jobs` schemas and `enqueuePublishJob()` helper match the spec's assumptions before implementation. The spec should use the existing queue helper, not write directly.

## REPO CONVENTIONS TO PRESERVE

- All server actions: `getUser()` at top, account-scoped queries, `revalidatePath()` after mutation
- Supabase: RLS always on, service-role only for system operations
- DB columns: snake_case; TypeScript: camelCase with `fromDb<T>()` conversion
- Publishing: use `enqueuePublishJob()` from `src/lib/publishing/queue.ts`, not direct inserts
- Preflight: call `getPublishReadinessIssues()` before queuing

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1: Re-review transaction strategy once defined
- [ ] CR-4: Re-review partially-published regeneration logic
- [ ] CR-5: Re-review media ownership model once decided (shared vs per-item)

## REVISION PROMPT

Apply all 16 spec revisions listed above to `docs/superpowers/specs/2026-05-09-tournament-content-design.md`. For each change: update the relevant section in-place (don't append). Preserve the existing structure and add detail where gaps were found. Key additions: generation preconditions, transaction boundary, dynamic platform iteration, regeneration skip-published logic, media ownership tagging, auth requirements, preflight integration, stagger formula, save-then-generate UX, input validation rules, and past-time handling.
