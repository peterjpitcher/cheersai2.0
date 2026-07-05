#!/usr/bin/env tsx
//
// backfill-event-overlays.ts
//
// One-off backfill for the "events auto-enable a date overlay" change. Newly
// created event posts now set banner_enabled = true (with a null override) so
// the publish worker prints the per-post proximity label (TONIGHT / THIS FRIDAY
// / FRIDAY 17TH JULY). This script switches the same auto-overlay ON for event
// posts that were already scheduled under the previous opt-in behaviour.
//
// SCOPE (a variant is enabled only when ALL hold):
//   - its content_item belongs to an EVENT campaign (campaign_type = 'event');
//   - the content_item is still unpublished (draft/review/approved/scheduled/
//     queued) — published/posted/failed rows are left untouched;
//   - the content_item placement is NOT 'story' (stories never carry overlays);
//   - banner_text_override IS NULL — never touch a deliberately-typed overlay;
//   - banner_enabled is currently false — i.e. the overlay is off.
//
// The override stays NULL: the worker computes the label per post date at
// publish, so nothing is frozen and the 20-char override limit never applies.
//
// SAFETY: dry-run by default. Prints the affected count and a sample and changes
// nothing. Re-run with --apply to perform the update.
//
//   npm run ops:backfill-event-overlays            # dry run (counts only)
//   npm run ops:backfill-event-overlays -- --apply
//
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const UNPUBLISHED_STATUSES = ["draft", "review", "approved", "scheduled", "queued"];
const PAGE_SIZE = 1000;
const IN_CHUNK = 200;
const UPDATE_CHUNK = 200;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Supabase credentials missing – set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function collectPaged<T>(
  build: (from: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from);
    if (error) {
      console.error("Query failed:", error.message);
      process.exit(1);
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main(): Promise<void> {
  console.log(APPLY ? "=== LIVE RUN (--apply) ===" : "=== DRY RUN (no changes) ===");
  console.log("Finding scheduled event posts whose date overlay is switched off...\n");

  // 1. Event campaign ids.
  const eventCampaigns = await collectPaged<{ id: string }>((from) =>
    supabase
      .from("campaigns")
      .select("id")
      .eq("campaign_type", "event")
      .range(from, from + PAGE_SIZE - 1),
  );
  const eventCampaignIds = eventCampaigns.map((row) => row.id);
  if (!eventCampaignIds.length) {
    console.log("No event campaigns found. Nothing to do.");
    return;
  }

  // 2. Unpublished, non-story content items in those campaigns.
  const contentItemIds: string[] = [];
  for (const ids of chunk(eventCampaignIds, IN_CHUNK)) {
    const items = await collectPaged<{ id: string }>((from) =>
      supabase
        .from("content_items")
        .select("id")
        .in("campaign_id", ids)
        .in("status", UNPUBLISHED_STATUSES)
        .neq("placement", "story")
        .range(from, from + PAGE_SIZE - 1),
    );
    contentItemIds.push(...items.map((row) => row.id));
  }
  if (!contentItemIds.length) {
    console.log("No unpublished event posts found. Nothing to do.");
    return;
  }

  // 3. Variants with the overlay off and no typed override.
  const affected: Array<{ id: string; content_item_id: string }> = [];
  for (const ids of chunk(contentItemIds, IN_CHUNK)) {
    const variants = await collectPaged<{ id: string; content_item_id: string }>((from) =>
      supabase
        .from("content_variants")
        .select("id, content_item_id")
        .in("content_item_id", ids)
        .eq("banner_enabled", false)
        .is("banner_text_override", null)
        .range(from, from + PAGE_SIZE - 1),
    );
    affected.push(...variants);
  }

  if (!affected.length) {
    console.log("No event variants need the overlay switched on. Nothing to do.");
    return;
  }

  console.log(`Found ${affected.length} event variant(s) to set banner_enabled = true (override stays null):`);
  console.log("\nSample (first 10):");
  for (const row of affected.slice(0, 10)) {
    console.log(`  variant ${row.id} (item ${row.content_item_id})`);
  }
  console.log();

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to switch these overlays on.");
    return;
  }

  let updated = 0;
  for (const ids of chunk(affected.map((r) => r.id), UPDATE_CHUNK)) {
    const { error } = await supabase
      .from("content_variants")
      .update({ banner_enabled: true })
      .in("id", ids);
    if (error) {
      console.error(`Update failed for a chunk of ${ids.length}:`, error.message);
      process.exit(1);
    }
    updated += ids.length;
    console.log(`  updated ${updated}/${affected.length}`);
  }

  console.log(`\nDone. Switched on the date overlay for ${updated} event variant(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
