#!/usr/bin/env tsx
//
// backfill-opt-in-overlays.ts
//
// One-off backfill supporting the "overlays are opt-in per post" change.
//
// Before that change, unpublished posts inherited an image overlay ("banner")
// they never opted into: wizard-created variants left banner_enabled NULL (so
// they inherited the account default of true) and the weekly worker force-wrote
// banner_enabled: true. This script turns those overlays OFF for content that
// has NOT yet been published, without touching posts where the owner set their
// own overlay text.
//
// SCOPE (a variant is turned off only when ALL hold):
//   - its content_item.status is still unpublished (draft/review/approved/
//     scheduled/queued) — published/posted/failed rows are left untouched;
//   - banner_text_override IS NULL — never disable a deliberately-set overlay;
//   - banner_enabled IS NULL or true — i.e. it currently shows an overlay.
//
// SAFETY: dry-run by default. It prints the affected count and a sample and
// changes nothing. Re-run with --apply to perform the update.
//
//   npm run ops:backfill-opt-in-overlays          # dry run (counts only)
//   npm run ops:backfill-opt-in-overlays -- --apply
//
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const UNPUBLISHED_STATUSES = ["draft", "review", "approved", "scheduled", "queued"];
const PAGE_SIZE = 1000;
const UPDATE_CHUNK = 200;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Supabase credentials missing – set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

type AffectedRow = {
  id: string;
  content_item_id: string;
  banner_enabled: boolean | null;
  content_items: { status: string; platform: string | null } | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  console.log(APPLY ? "=== LIVE RUN (--apply) ===" : "=== DRY RUN (no changes) ===");
  console.log("Finding unpublished variants that inherit an unwanted overlay...\n");

  // Collect affected variants, paginating to avoid the default row cap. The
  // !inner join restricts to variants whose content_item is still unpublished.
  const affected: AffectedRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("content_variants")
      .select("id, content_item_id, banner_enabled, content_items!inner(status, platform)")
      .is("banner_text_override", null)
      .or("banner_enabled.is.null,banner_enabled.eq.true")
      .in("content_items.status", UNPUBLISHED_STATUSES)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Query failed:", error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as unknown as AffectedRow[];
    affected.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  if (affected.length === 0) {
    console.log("No affected variants found. Nothing to do.");
    return;
  }

  // Summary breakdown by status + platform for transparency.
  const byStatus = new Map<string, number>();
  for (const row of affected) {
    const key = row.content_items?.status ?? "unknown";
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }

  console.log(`Found ${affected.length} variant(s) that will be set to banner_enabled = false:`);
  for (const [status, count] of [...byStatus.entries()].sort()) {
    console.log(`  status=${status}: ${count}`);
  }
  console.log("\nSample (first 10):");
  for (const row of affected.slice(0, 10)) {
    console.log(
      `  variant ${row.id} (item ${row.content_item_id}, ${row.content_items?.platform ?? "?"}, ${row.content_items?.status ?? "?"}, banner_enabled=${row.banner_enabled})`,
    );
  }
  console.log();

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to turn these overlays off.");
    return;
  }

  let updated = 0;
  for (const ids of chunk(affected.map((r) => r.id), UPDATE_CHUNK)) {
    const { error } = await supabase
      .from("content_variants")
      .update({ banner_enabled: false })
      .in("id", ids);
    if (error) {
      console.error(`Update failed for a chunk of ${ids.length}:`, error.message);
      process.exit(1);
    }
    updated += ids.length;
    console.log(`  updated ${updated}/${affected.length}`);
  }

  console.log(`\nDone. Turned off ${updated} overlay(s) on unpublished posts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
