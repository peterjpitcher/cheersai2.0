import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing Supabase credentials. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const PAGE_SIZE = 1000;

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function fetchContentRows() {
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await supabase
      .from("content_items")
      .select(
        "id, platform, placement, status, scheduled_for, deleted_at, campaigns(name), content_variants(id, body)"
      )
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...data);

    if (data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

function normaliseVariants(variants) {
  if (!variants) return [];
  return Array.isArray(variants) ? variants : [variants];
}

async function main() {
  const rows = await fetchContentRows();

  const header = [
    "content_item_id",
    "variant_id",
    "platform",
    "placement",
    "status",
    "scheduled_for",
    "campaign_name",
    "deleted_at",
    "body",
  ];

  const lines = [header.join(",")];

  for (const row of rows) {
    const variants = normaliseVariants(row.content_variants);
    if (!variants.length) {
      lines.push(
        [
          row.id,
          "",
          row.platform,
          row.placement,
          row.status,
          row.scheduled_for ?? "",
          row.campaigns?.name ?? "",
          row.deleted_at ?? "",
          "",
        ]
          .map(csvEscape)
          .join(",")
      );
      continue;
    }

    for (const variant of variants) {
      lines.push(
        [
          row.id,
          variant?.id ?? "",
          row.platform,
          row.placement,
          row.status,
          row.scheduled_for ?? "",
          row.campaigns?.name ?? "",
          row.deleted_at ?? "",
          variant?.body ?? "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }
  }

  const outputPath = path.join(process.cwd(), "social-copy.csv");
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");

  console.log(`Wrote ${lines.length - 1} rows to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
