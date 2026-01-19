#!/usr/bin/env tsx
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

type CampaignRow = {
  id: string;
  account_id: string;
  name: string;
  link_in_bio_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Supabase credentials missing – set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function getFlag(name: string) {
  return process.argv.slice(2).includes(name);
}

function getOption(name: string) {
  const index = process.argv.slice(2).findIndex((value) => value === name);
  if (index === -1) return null;
  return process.argv.slice(2)[index + 1] ?? null;
}

function normaliseUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function resolveFacebookCtaUrl(metadata: CampaignRow["metadata"]) {
  return normaliseUrl(metadata?.ctaUrl);
}

async function fetchCampaignsMissingLinkInBioUrl() {
  const pageSize = 1000;
  const rows: CampaignRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, account_id, name, link_in_bio_url, metadata, created_at")
      .is("link_in_bio_url", null)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1)
      .returns<CampaignRow[]>();

    if (error) {
      throw error;
    }

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function main() {
  const shouldApply = getFlag("--apply");
  const dryRun = !shouldApply;
  const limitRaw = getOption("--limit");
  const limit = limitRaw ? Number(limitRaw) : null;
  const accountFilter = getOption("--account");

  const missingLink = await fetchCampaignsMissingLinkInBioUrl();

  const candidates = missingLink
    .filter((row) => !accountFilter || row.account_id === accountFilter)
    .map((row) => ({ row, ctaUrl: resolveFacebookCtaUrl(row.metadata) }))
    .filter((entry): entry is { row: CampaignRow; ctaUrl: string } => Boolean(entry.ctaUrl));

  const limitedCandidates = typeof limit === "number" && Number.isFinite(limit)
    ? candidates.slice(0, Math.max(limit, 0))
    : candidates;

  console.log("Campaign link-in-bio backfill");
  console.log(`  • Missing link_in_bio_url: ${missingLink.length}`);
  console.log(`  • Missing + has Facebook CTA URL: ${candidates.length}`);
  if (accountFilter) {
    console.log(`  • Account filter: ${accountFilter}`);
  }
  if (typeof limit === "number" && Number.isFinite(limit)) {
    console.log(`  • Limit: ${limit}`);
  }
  console.log(`  • Mode: ${dryRun ? "dry-run" : "apply"}`);

  if (!limitedCandidates.length) {
    console.log("\nNothing to backfill.");
    return;
  }

  console.log("\nSample (first 20):");
  for (const entry of limitedCandidates.slice(0, 20)) {
    console.log(`  - ${entry.row.created_at} | ${entry.row.account_id} | ${entry.row.id} | ${entry.row.name} -> ${entry.ctaUrl}`);
  }

  if (dryRun) {
    console.log("\nDry run complete. Re-run with `--apply` to update campaigns.");
    return;
  }

  let updated = 0;
  let failed = 0;
  const failures: string[] = [];

  const concurrency = 10;
  const nowIso = new Date().toISOString();

  for (let index = 0; index < limitedCandidates.length; index += concurrency) {
    const chunk = limitedCandidates.slice(index, index + concurrency);
    await Promise.all(
      chunk.map(async ({ row, ctaUrl }) => {
        try {
          const { error } = await supabase
            .from("campaigns")
            .update({ link_in_bio_url: ctaUrl, updated_at: nowIso })
            .eq("id", row.id);

          if (error) {
            throw error;
          }

          updated += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${row.id} (${row.name}): ${message}`);
        }
      }),
    );
  }

  console.log("\nBackfill summary:");
  console.log(`  • Updated: ${updated}`);
  console.log(`  • Failed: ${failed}`);

  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
  }

  const after = await fetchCampaignsMissingLinkInBioUrl();
  const remaining = after
    .filter((row) => !accountFilter || row.account_id === accountFilter)
    .map((row) => ({ row, ctaUrl: resolveFacebookCtaUrl(row.metadata) }))
    .filter((entry): entry is { row: CampaignRow; ctaUrl: string } => Boolean(entry.ctaUrl));

  console.log("\nPost-check:");
  console.log(`  • Still missing link_in_bio_url + has Facebook CTA URL: ${remaining.length}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("❌ Backfill failed:", error);
  process.exit(1);
});

