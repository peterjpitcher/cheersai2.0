#!/usr/bin/env tsx
//
// regenerate-rugby-posts.ts
//
// Rebuilds the unpublished posts of a rugby tournament through the normal
// generation path after the rugby post template changes
// (tasks/SPEC-rugby-match-posts.md). The publish worker refuses posts built on
// an older template version, so they must be regenerated after each release.
//
// SCOPE: fixtures of the given tournament that already have generated posts.
// Published posts, and any placement that already published, are never touched:
// the generator skips placements that reached the published state. Nothing is
// published immediately; a post whose time has passed is created but not queued,
// exactly as the generator does today.
//
// SAFETY: read only by default. --apply deletes each fixture's unpublished posts
// and regenerates them. Needs the owner's yes at the time. A game that fails is
// retried on its own twice; anything still failing is listed and left without
// posts, so a re-run picks it up: --include-missing also generates every showing
// game with confirmed teams that has no posts (what "Generate all" does).
//
// Run it on Node 24, as production does: Node 26's fetch failed mid-upload with
// an HTTP/2 stream error on 17 October 2026.
//
//   npm run ops:regenerate-rugby-posts -- --tournament <id>                      # read only
//   npm run ops:regenerate-rugby-posts -- --tournament <id> --apply
//   npm run ops:regenerate-rugby-posts -- --tournament <id> --apply --include-missing
//
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const PUBLISHED = new Set(["published", "posted", "succeeded"]);

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const includeMissing = args.includes("--include-missing");
  const tournamentId = argValue(args, "--tournament");
  if (!tournamentId) {
    console.error("Usage: npm run ops:regenerate-rugby-posts -- --tournament <id> [--apply]");
    process.exit(1);
  }

  // Imported after dotenv so the app's env module reads .env.local.
  const { createServiceSupabaseClient } = await import("@/lib/supabase/service");
  const { getTournamentById, getFixturesByTournament } = await import("@/lib/tournament/queries");
  const { bulkGenerateContent, deleteFixtureContentItems } = await import("@/lib/tournament/generate");
  const { NATIONS_TEMPLATE_VERSION } = await import("../../supabase/functions/_shared/nations-content-contract");

  const db = createServiceSupabaseClient();
  const { data: row, error: rowError } = await db.from("tournaments").select("account_id").eq("id", tournamentId).maybeSingle();
  if (rowError || !row) throw new Error(`Tournament ${tournamentId} not found`);
  const accountId = row.account_id as string;
  const tournament = await getTournamentById(db, tournamentId, accountId);
  if (!tournament) throw new Error(`Tournament ${tournamentId} not found for its account`);
  if (tournament.sport !== "rugby_union") throw new Error("Only rugby tournaments use the screening template.");

  const fixtures = await getFixturesByTournament(db, tournamentId);
  const missing = fixtures.filter((fixture) => !fixture.contentGenerated && fixture.showing && fixture.teamsConfirmed);
  const targets = fixtures.filter((fixture) => fixture.contentGenerated || (includeMissing && missing.includes(fixture)));

  const { data: items, error: itemsError } = await db
    .from("content_items")
    .select("id, status, platform, placement, scheduled_for, prompt_context")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .contains("prompt_context", { source: "tournament", tournament_id: tournamentId });
  if (itemsError) throw itemsError;

  console.log(`${tournament.name}: ${fixtures.length} fixtures, ${fixtures.filter((fixture) => fixture.contentGenerated).length} with posts, ${missing.length} showing with confirmed teams but no posts${includeMissing ? " (included)" : ""}. Current template ${NATIONS_TEMPLATE_VERSION}.`);
  for (const fixture of targets) {
    const own = (items ?? []).filter((item) => (item.prompt_context as Record<string, unknown>)?.tournament_fixture_id === fixture.id);
    const unpublished = own.filter((item) => !PUBLISHED.has(String(item.status)));
    const versions = [...new Set(unpublished.map((item) => String((item.prompt_context as Record<string, unknown>)?.screening_template_version ?? "none")))];
    console.log(`  ${fixture.kickOffAt}  ${fixture.teamA} v ${fixture.teamB}: ${unpublished.length} unpublished (${versions.join(", ") || "-"}), ${own.length - unpublished.length} published`);
  }

  if (!apply) {
    console.log("\nRead only. Re-run with --apply to regenerate the unpublished posts.");
    return;
  }

  for (const fixture of targets) {
    await deleteFixtureContentItems(db, fixture.id, accountId, true);
    const { error } = await db.from("tournament_fixtures").update({ content_generated: false }).eq("id", fixture.id).eq("tournament_id", tournamentId);
    if (error) throw error;
  }

  // Each failed game rolls back its own partial posts, so it can simply be retried.
  let pending = new Set(targets.map((fixture) => fixture.id));
  let errors: Array<{ fixtureId: string; error: string }> = [];
  let generated = 0;
  for (let attempt = 1; attempt <= 3 && pending.size; attempt += 1) {
    const refreshed = await getFixturesByTournament(db, tournamentId);
    const batch = refreshed.filter((fixture) => pending.has(fixture.id) && !fixture.contentGenerated);
    if (!batch.length) break;
    const result = attempt === 1
      ? await bulkGenerateContent(tournament, batch)
      : await batch.reduce(async (previous, fixture) => {
        const totals = await previous;
        const single = await bulkGenerateContent(tournament, [fixture]);
        return { generated: totals.generated + single.generated, skipped: 0, errors: [...totals.errors, ...single.errors] };
      }, Promise.resolve({ generated: 0, skipped: 0, errors: [] as Array<{ fixtureId: string; error: string }> }));
    generated += result.generated;
    errors = result.errors;
    pending = new Set(errors.map((failure) => failure.fixtureId));
    console.log(`Attempt ${attempt}: generated ${result.generated}, failed ${errors.length}.`);
  }
  console.log(`\nGenerated ${generated}, failed ${errors.length}.`);
  for (const failure of errors) console.log(`  FAILED ${failure.fixtureId}: ${failure.error.split("\n")[0]}`);
  const result = { errors };

  const { data: after, error: afterError } = await db
    .from("content_items")
    .select("status, prompt_context")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .contains("prompt_context", { source: "tournament", tournament_id: tournamentId });
  if (afterError) throw afterError;
  const byVersion = new Map<string, number>();
  for (const item of after ?? []) {
    if (PUBLISHED.has(String(item.status))) continue;
    const version = String((item.prompt_context as Record<string, unknown>)?.screening_template_version ?? "none");
    byVersion.set(version, (byVersion.get(version) ?? 0) + 1);
  }
  console.log(`Unpublished posts by template: ${[...byVersion].map(([version, count]) => `${version} ${count}`).join(", ") || "none"}`);
  if (result.errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
