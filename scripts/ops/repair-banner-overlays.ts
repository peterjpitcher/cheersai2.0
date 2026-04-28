import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envFiles = [".env", ".env.local"];
for (const file of envFiles) {
  const fullPath = resolve(process.cwd(), file);
  if (existsSync(fullPath)) {
    loadEnv({ path: fullPath, override: false });
  }
}

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase credentials. Provide NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type CandidateRow = {
  id: string;
  account_id: string;
  status: string;
  scheduled_for: string | null;
  prompt_context: Record<string, unknown> | null;
  content_variants: Array<{
    id: string;
    banner_state: string | null;
    bannered_media_path: string | null;
  }> | {
    id: string;
    banner_state: string | null;
    bannered_media_path: string | null;
  } | null;
};

function normaliseVariants(row: CandidateRow["content_variants"]) {
  if (!row) return [];
  return Array.isArray(row) ? row : [row];
}

async function main() {
  const { renderBannerForContent } = await import("../../src/lib/scheduling/banner-renderer.server");
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("content_items")
    .select("id, account_id, status, scheduled_for, prompt_context, content_variants(id, banner_state, bannered_media_path)")
    .in("status", ["scheduled", "queued"])
    .gte("scheduled_for", nowIso)
    .is("deleted_at", null)
    .order("scheduled_for", { ascending: true })
    .limit(Number.isFinite(limit) && limit > 0 ? limit : 500)
    .returns<CandidateRow[]>();

  if (error) throw error;

  const candidates = (data ?? []).filter((row) => {
    const banner = row.prompt_context?.banner;
    const bannerEnabled = Boolean(banner && typeof banner === "object" && (banner as { enabled?: unknown }).enabled === true);
    if (!bannerEnabled) return false;
    const variant = normaliseVariants(row.content_variants)[0];
    return !variant || variant.banner_state === "none" || !variant.banner_state;
  });

  console.info(`${apply ? "Repairing" : "Dry run:"} ${candidates.length} banner-enabled queued/scheduled post(s) need inspection.`);

  let rendered = 0;
  let notApplicable = 0;
  let failed = 0;

  for (const row of candidates) {
    const variant = normaliseVariants(row.content_variants)[0];
    console.info(`[banner-repair] ${row.id} ${row.status} ${row.scheduled_for ?? "unscheduled"} variant=${variant?.id ?? "missing"}`);

    if (!apply) continue;

    try {
      const result = await renderBannerForContent({
        contentId: row.id,
        variantId: variant?.id,
        supabase,
      });
      if (result.status === "rendered") rendered += 1;
      if (result.status === "not_applicable") notApplicable += 1;
      console.info(`[banner-repair] ${row.id} -> ${result.status}`);
    } catch (renderError) {
      failed += 1;
      const message = renderError instanceof Error ? renderError.message : String(renderError);
      console.error(`[banner-repair] ${row.id} failed: ${message}`);

      await supabase
        .from("content_items")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .eq("id", row.id);

      await supabase
        .from("publish_jobs")
        .update({
          status: "failed",
          last_error: `Banner repair failed: ${message}`,
          next_attempt_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("content_item_id", row.id)
        .in("status", ["queued"]);

      await supabase.from("notifications").insert({
        account_id: row.account_id,
        category: "banner_invalidated",
        message: "Post needs banner rendering before it can publish.",
        metadata: {
          contentId: row.id,
          error: message,
        },
      });
    }
  }

  console.info(`[banner-repair] rendered=${rendered} notApplicable=${notApplicable} failed=${failed} apply=${apply}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
