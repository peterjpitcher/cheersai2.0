#!/usr/bin/env tsx
//
// repair-hidden-media-references.ts
//
// One-off repair for planned posts that still reference media assets which have
// since been hidden in the library. Before the replacement flow was hardened,
// the old asset could be hidden while references to it remained (no transaction,
// a unique-constraint collision could abort mid-sequence), leaving stale
// references pointing at an invisible asset.
//
// MODES
//   Detect / report (default): scans content_variants.media_ids and
//     content_media_attachments for references to any hidden media_assets row,
//     and prints a grouped summary. Changes nothing. No mapping required.
//
//   Remediate (--apply + a mapping): re-points references from each old (hidden)
//     asset id to the supplied new asset id, using the same collision-safe logic
//     as the app (dedupe on the UNIQUE (content_item_id, media_id) constraint)
//     and ensuring the new asset exists in media_library first (FK target).
//
// There is no stored old→new replacement history, so remediation NEVER guesses a
// mapping — you must supply it explicitly:
//   --map <oldId>=<newId>        (repeatable)
//   --mapping-file <path.json>   ({ "<oldId>": "<newId>", ... })
//
// SAFETY: detect/report by default; only --apply writes. Detected danglers whose
// old id is not in the mapping are reported and left untouched (never silently
// dropped).
//
//   npm run ops:repair-hidden-media-references
//   npm run ops:repair-hidden-media-references -- --apply --map OLD=NEW
//   npm run ops:repair-hidden-media-references -- --apply --mapping-file repair.json
//
import fs from "node:fs";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const PAGE_SIZE = 1000;

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

type HiddenAsset = { id: string; account_id: string; file_name: string | null };
type VariantRow = { id: string; content_item_id: string; media_ids: string[] | null };
type AttachmentRow = { id: string; content_item_id: string; media_id: string };
type MediaAssetRow = {
  id: string;
  account_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  tags: string[] | null;
};

function parseMapping(): Map<string, string> {
  const mapping = new Map<string, string>();

  const fileFlagIndex = argv.indexOf("--mapping-file");
  if (fileFlagIndex !== -1) {
    const path = argv[fileFlagIndex + 1];
    if (!path) {
      console.error("--mapping-file requires a path argument.");
      process.exit(1);
    }
    const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as Record<string, string>;
    for (const [oldId, newId] of Object.entries(parsed)) {
      mapping.set(oldId, newId);
    }
  }

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--map") continue;
    const pair = argv[i + 1];
    if (!pair || !pair.includes("=")) {
      console.error("--map expects <oldId>=<newId>.");
      process.exit(1);
    }
    const [oldId, newId] = pair.split("=");
    mapping.set(oldId.trim(), newId.trim());
  }

  return mapping;
}

async function loadHiddenAssets(): Promise<Map<string, HiddenAsset>> {
  const hidden = new Map<string, HiddenAsset>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("media_assets")
      .select("id, account_id, file_name")
      .not("hidden_at", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("Failed to load hidden assets:", error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as HiddenAsset[];
    for (const row of rows) hidden.set(row.id, row);
    if (rows.length < PAGE_SIZE) break;
  }
  return hidden;
}

async function loadDanglingVariants(hidden: Map<string, HiddenAsset>): Promise<VariantRow[]> {
  const affected: VariantRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("content_variants")
      .select("id, content_item_id, media_ids")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("Failed to scan content_variants:", error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as VariantRow[];
    for (const row of rows) {
      if ((row.media_ids ?? []).some((id) => hidden.has(id))) affected.push(row);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return affected;
}

async function loadDanglingAttachments(hidden: Map<string, HiddenAsset>): Promise<AttachmentRow[]> {
  const affected: AttachmentRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("content_media_attachments")
      .select("id, content_item_id, media_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("Failed to scan content_media_attachments:", error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as AttachmentRow[];
    for (const row of rows) {
      if (hidden.has(row.media_id)) affected.push(row);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return affected;
}

function countByOldId(variants: VariantRow[], attachments: AttachmentRow[], hidden: Map<string, HiddenAsset>) {
  const byOld = new Map<string, { variants: number; attachments: number }>();
  const bump = (oldId: string, key: "variants" | "attachments") => {
    const entry = byOld.get(oldId) ?? { variants: 0, attachments: 0 };
    entry[key] += 1;
    byOld.set(oldId, entry);
  };
  for (const v of variants) {
    for (const id of v.media_ids ?? []) {
      if (hidden.has(id)) bump(id, "variants");
    }
  }
  for (const a of attachments) bump(a.media_id, "attachments");
  return byOld;
}

async function ensureInMediaLibrary(newId: string): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("media_library")
    .select("id")
    .eq("id", newId)
    .maybeSingle<{ id: string }>();
  if (existingError) throw new Error(existingError.message);
  if (existing) return;

  const { data: asset, error: assetError } = await supabase
    .from("media_assets")
    .select("id, account_id, file_name, storage_path, mime_type, size_bytes, tags")
    .eq("id", newId)
    .maybeSingle<MediaAssetRow>();
  if (assetError) throw new Error(assetError.message);
  if (!asset) throw new Error(`Replacement asset ${newId} not found in media_assets.`);

  const { error: upsertError } = await supabase.from("media_library").upsert(
    {
      id: asset.id,
      account_id: asset.account_id,
      file_name: asset.file_name,
      file_url: asset.storage_path,
      file_type: asset.mime_type ?? "image/jpeg",
      file_size_bytes: asset.size_bytes,
      tags: asset.tags ?? [],
    },
    { onConflict: "id" },
  );
  if (upsertError) throw new Error(upsertError.message);
}

async function remediatePair(
  oldId: string,
  newId: string,
  variants: VariantRow[],
  attachments: AttachmentRow[],
): Promise<{ variants: number; attachmentsUpdated: number; attachmentsDeduped: number }> {
  await ensureInMediaLibrary(newId);

  // Variants: replace old→new in the array and dedupe.
  let variantsUpdated = 0;
  for (const variant of variants) {
    const mediaIds = variant.media_ids ?? [];
    if (!mediaIds.includes(oldId)) continue;
    const next: string[] = [];
    for (const id of mediaIds) {
      const replacement = id === oldId ? newId : id;
      if (!next.includes(replacement)) next.push(replacement);
    }
    const { error } = await supabase.from("content_variants").update({ media_ids: next }).eq("id", variant.id);
    if (error) throw new Error(error.message);
    variantsUpdated += 1;
  }

  // Attachments: collision-safe. Delete the old row where the content item
  // already has the new asset attached; otherwise re-point it.
  const oldRows = attachments.filter((row) => row.media_id === oldId);
  const contentItemIds = Array.from(new Set(oldRows.map((row) => row.content_item_id)));

  const collidingItemIds = new Set<string>();
  for (const contentItemId of contentItemIds) {
    const { data, error } = await supabase
      .from("content_media_attachments")
      .select("id")
      .eq("content_item_id", contentItemId)
      .eq("media_id", newId)
      .maybeSingle<{ id: string }>();
    if (error) throw new Error(error.message);
    if (data) collidingItemIds.add(contentItemId);
  }

  const idsToDelete = oldRows.filter((row) => collidingItemIds.has(row.content_item_id)).map((row) => row.id);
  const idsToUpdate = oldRows.filter((row) => !collidingItemIds.has(row.content_item_id)).map((row) => row.id);

  if (idsToDelete.length) {
    const { error } = await supabase.from("content_media_attachments").delete().in("id", idsToDelete);
    if (error) throw new Error(error.message);
  }
  if (idsToUpdate.length) {
    const { error } = await supabase
      .from("content_media_attachments")
      .update({ media_id: newId })
      .in("id", idsToUpdate);
    if (error) throw new Error(error.message);
  }

  return { variants: variantsUpdated, attachmentsUpdated: idsToUpdate.length, attachmentsDeduped: idsToDelete.length };
}

async function main(): Promise<void> {
  console.log(APPLY ? "=== LIVE RUN (--apply) ===" : "=== DRY RUN (detect / report only) ===");

  const hidden = await loadHiddenAssets();
  console.log(`Hidden media assets: ${hidden.size}`);

  const [variants, attachments] = await Promise.all([
    loadDanglingVariants(hidden),
    loadDanglingAttachments(hidden),
  ]);

  const byOld = countByOldId(variants, attachments, hidden);

  if (byOld.size === 0) {
    console.log("\nNo planned-post references to hidden assets. Nothing to repair.");
    return;
  }

  console.log(
    `\nFound references to ${byOld.size} hidden asset(s): ${variants.length} variant(s), ${attachments.length} attachment(s).`,
  );
  console.log("\nSample (first 10 hidden assets):");
  for (const [oldId, counts] of [...byOld.entries()].slice(0, 10)) {
    const meta = hidden.get(oldId);
    console.log(
      `  ${oldId} (${meta?.file_name ?? "?"}): ${counts.variants} variant(s), ${counts.attachments} attachment(s)`,
    );
  }
  console.log();

  if (!APPLY) {
    console.log("Dry run complete. To remediate, re-run with --apply and a mapping:");
    console.log("  npm run ops:repair-hidden-media-references -- --apply --map OLD=NEW [--map OLD2=NEW2 ...]");
    console.log("  npm run ops:repair-hidden-media-references -- --apply --mapping-file repair.json");
    return;
  }

  const mapping = parseMapping();
  if (mapping.size === 0) {
    console.error("\n--apply requires a mapping (--map <oldId>=<newId> or --mapping-file <path.json>). Aborting.");
    process.exit(1);
  }

  // Report any detected danglers not covered by the mapping — never silent.
  const uncovered = [...byOld.keys()].filter((oldId) => !mapping.has(oldId));
  if (uncovered.length) {
    console.log(`\nWARNING: ${uncovered.length} hidden asset(s) with references are NOT in the mapping and will be skipped:`);
    for (const oldId of uncovered.slice(0, 20)) console.log(`  ${oldId}`);
  }

  console.log("\nRemediating mapped pairs...");
  for (const [oldId, newId] of mapping.entries()) {
    if (!byOld.has(oldId)) {
      console.log(`  ${oldId} → ${newId}: no references found, skipping.`);
      continue;
    }
    const result = await remediatePair(oldId, newId, variants, attachments);
    console.log(
      `  ${oldId} → ${newId}: variants=${result.variants}, attachments updated=${result.attachmentsUpdated}, deduped=${result.attachmentsDeduped}`,
    );
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
