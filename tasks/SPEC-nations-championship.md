# Nations Championship implementation

Canonical specification: [website delivery specification](../../nations-website/tasks/spec-2026-09-05-nations-championship.md).
Canonical implementation plan: [website plan](../../nations-website/tasks/plan-2026-09-05-nations-championship.md).

The owner authorised implementation on 5 September 2026. Existing opening and kitchen times stay unchanged. Confirmed early games show from opening, retain a booking CTA and state that the start is missed. Food promotion uses exact management service intervals. No production migration, fixture import or provider send is included in local implementation.

## Schema preflight

Verified project from this checkout's environment URL: cheersai2.0, nbkjciurhvkfpcpatbnt. Live read-only checks found one tournament and 104 fixtures, at 81,920 and 139,264 bytes. Round is a text check with seven football values. Both tables have RLS, with fixture membership enforced through the parent tournament. No dependent views or materialized views. Both update triggers call set_updated_at, which changes updated_at only. Existing grants and policies are preserved. Latest applied migration at review: 20260905054726_revoke_anon_execute_on_trigger_functions.

Draft: 20260905071016_nations_championship_screenings.sql. Adds default-football sport, nullable import and scheduling facts, unconfirmed screening defaults, revision and widened rounds. Does not infer historical confirmation or write historical showing flags. New partial unique import index is tournament-scoped. Constant defaults avoid a table rewrite on modern PostgreSQL; ALTER TABLE takes a brief exclusive lock, bounded by a five-second lock timeout. New checks validate 104 existing rows and the unique index scans them. Production approval must include these constraints/index and exact checksum.

Validation used an isolated PostgreSQL 17 instance on local port 55439 and the repository's two table definitions with synthetic football data. Exact migration applied successfully, historical showing survived, new rugby rounds succeeded, duplicate import keys and invalid end/decision values were rejected. This limited database harness does not recreate Supabase authentication/RLS; no grants or policies are changed. Full application integration and production verification remain release gates.

Rollback preference: roll application code back while retaining additive columns and widened rounds. This preserves all data and has no SQL requirement. A destructive schema rollback is not authorised and would lose new screening facts.

## API detail

fetchScreeningHours(dates, config) takes existing ManagementApiConfig explicitly so background publishers and feeds can use account-scoped configuration without requiring a browser session. It validates the success envelope and exact requested dates, rejects redirects, uses no-store and bounded timeout. Missing hours never fall back to normal opening.

Old football fixtures retain their existing caller path. Optional additive TournamentFixture fields keep existing fixtures compatible; toScreeningFacts creates the strict public projection input. Schema 2 consumers derive coverage from the projection status, never submitted coverage.

## Editor, feed and publishing integration

Schema 2 resolves the exact key-owned tournament by UUID or slug, requires active status and returns no-store projections. The website needs a separate Nations feed key; the World Cup key cannot access a different tournament. Past fixtures use unknown historical hours and cannot produce a future booking claim. The official 24-row CSV remains an import candidate only; all planned screening end estimates are empty pending real operational input.

Every rugby create/edit/toggle/import/save-and-generate path uses the shared screening policy. Edits use optimistic revision checks, then invalidate unpublished content. This is deliberately not described as a multi-statement transaction: if cancellation fails after the revision write, the action reports that state explicitly and the delivery guard rejects the old snapshot. Published content is retained; preview flags changed fixture/tournament snapshots for review.

Draft migration 20260905072213_tournament_screening_revision_guard.sql adds an invoker trigger, with direct public/anon/authenticated execution revoked. It serialises rugby confirmations by account using a transaction advisory lock, rejects overlapping screen/commentary allocations across tournaments, and increments revision automatically for changed facts. Isolated PostgreSQL 17 validation exercised the exact SQL, automatic revision, collision rejection and revoked anon execution. No production apply. Rollback is application rollback with additive schema retained; disabling a guard is not an automatic rollback step.

Both QStash and legacy publishers recheck account ownership, current tournament/fixture snapshot and current hours before their provider entry point. A mismatch or inability to verify is non-retryable and requires review. Provider calls already in flight cannot be recalled. The two publisher guard implementations need corresponding updates if the contract changes.

Rugby copy uses confirmed screening facts rather than unrestricted football templates. Food invitations and exact kitchen intervals appear in feed copy, story artwork and stored story preview wording. Stories keep their existing empty-caption transport convention. Existing football content and default feed remain on their original paths.
