import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// Patterns to strip "slot N" references and surrounding grammar artefacts
const SLOT_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // "It's slot 4 and there's" → "There's" (capitalised to start the sentence)
  { pattern: /\bIt['\u2018\u2019]s\s+slot\s+\d+\s+and\s+there['\u2018\u2019]s\s+/gi, replacement: "There\u2019s " },
  // "It's slot 4 and" (without "there's") → ""
  { pattern: /\bIt['\u2018\u2019]s\s+slot\s+\d+\s+and\s+/gi, replacement: "" },
  // "for Slot 2 and get ready" → "and get ready"
  { pattern: /\bfor\s+slot\s+\d+\s+and\s+/gi, replacement: "and " },
  // "Slot 7 of" → "" (e.g. "for Slot 7 of Open Mic Night")
  { pattern: /\bslot\s+\d+\s+of\s+/gi, replacement: "" },
  // "— Slot 2." → "." (trailing dash + slot + punctuation)
  { pattern: /\s*[—–-]+\s*\bslot\s+\d+\b/gi, replacement: "" },
  // ", slot 3," → "," (slot between commas)
  { pattern: /,\s*\bslot\s+\d+\b\s*,/gi, replacement: "," },
  // ", slot 6." → "." (slot at end of clause)
  { pattern: /,\s*\bslot\s+\d+\b\s*\./gi, replacement: "." },
  // Remaining "slot N" with optional trailing punctuation
  { pattern: /\bslot\s+\d+\b[.,;:!?\s]*/gi, replacement: " " },
];

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");
  console.log("Finding scheduled/draft posts with 'slot' language...\n");

  // Find content_variants joined with content_items that are not yet published
  const { data: rows, error } = await supabase
    .from("content_variants")
    .select("content_item_id, body, content_items!inner(id, status, platform)")
    .in("content_items.status", ["draft", "scheduled", "queued"])
    .ilike("body", "%slot %");

  if (error) {
    console.error("Query error:", error);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log("No affected posts found. Nothing to update.");
    return;
  }

  console.log(`Found ${rows.length} post(s) with potential slot language:\n`);

  let updated = 0;

  for (const row of rows) {
    const original = row.body ?? "";
    // Check if any pattern matches
    const hasSlot = SLOT_PATTERNS.some(({ pattern }) => { pattern.lastIndex = 0; return pattern.test(original); });
    if (!hasSlot) continue;

    let cleaned = original;
    for (const { pattern, replacement } of SLOT_PATTERNS) {
      pattern.lastIndex = 0;
      cleaned = cleaned.replace(pattern, replacement);
    }
    cleaned = cleaned
      .replace(/\s{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/ ([.,;:!?])/g, "$1")
      .trim();

    const contentItem = row.content_items as unknown as { id: string; status: string; platform: string };
    console.log(`--- ${row.content_item_id} [${contentItem.platform}] (${contentItem.status}) ---`);
    console.log(`  BEFORE: ${original.substring(0, 200)}...`);
    console.log(`  AFTER:  ${cleaned.substring(0, 200)}...`);
    console.log();

    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from("content_variants")
        .update({ body: cleaned })
        .eq("content_item_id", row.content_item_id);

      if (updateError) {
        console.error(`  ERROR updating ${row.content_item_id}:`, updateError);
      } else {
        updated++;
      }
    }
  }

  if (DRY_RUN) {
    console.log("Dry run complete. Re-run without --dry-run to apply changes.");
  } else {
    console.log(`Done. Updated ${updated} post(s).`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
