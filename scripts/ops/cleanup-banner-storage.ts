/**
 * Storage cleanup: delete leftover bannered JPEGs.
 *
 * WHEN TO RUN: Run once after Migration 2 + the dead-code commit have
 * shipped to all environments (production included). At that point the
 * `bannered_media_path` column has been dropped and no code reads or
 * writes the cached banner objects, so it is safe to delete them.
 *
 * Idempotent — safe to re-run if it errors partway through. Re-running
 * against an empty prefix prints `Deleted ~0 objects` and exits 0.
 *
 * Storage layout in this project:
 *   bucket = MEDIA_BUCKET ("media")
 *   prefix = "banners/{contentId}/{variantId}.jpg"
 * The Supabase Storage API addresses paths *within* a bucket, so we
 * scope listing to the `banners/` prefix and recurse into subfolders.
 *
 * Exit codes:
 *   0 — success (all listed objects deleted, or nothing to delete)
 *   1 — fatal error (missing env vars, list failure, unexpected throw)
 *   2 — partial failure (some files failed to delete; safe to re-run)
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const envFiles = [".env", ".env.local"];
for (const file of envFiles) {
  const fullPath = resolve(process.cwd(), file);
  if (existsSync(fullPath)) {
    loadEnv({ path: fullPath, override: false });
  }
}

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing Supabase credentials. Provide NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

// Bucket holding the bannered JPEGs. The plan suggested a dedicated
// `banners` bucket, but this project stores them inside the shared
// `media` bucket under a `banners/` prefix (see
// `src/lib/scheduling/banner-renderer.server.ts` and
// `src/app/(app)/planner/actions.ts`).
const BUCKET = "media";
const PREFIX = "banners";
const PAGE = 1000;

const supabase: SupabaseClient = createClient(
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/**
 * Recursively collect every leaf object path under a Supabase Storage
 * folder. Supabase's `list()` returns one level at a time and is
 * paginated, so we walk the tree breadth-first and page through each
 * folder until exhausted.
 */
async function listAllObjects(folder: string): Promise<string[]> {
  const paths: string[] = [];
  const queue: string[] = [folder];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    let offset = 0;

    while (true) {
      const { data, error } = await supabase.storage.from(BUCKET).list(current, {
        limit: PAGE,
        offset,
      });
      if (error) {
        throw new Error(`list failed for "${current}": ${error.message}`);
      }
      if (!data || data.length === 0) break;

      for (const entry of data) {
        if (!entry.name) continue;
        const childPath = current ? `${current}/${entry.name}` : entry.name;
        // Folders have a null id; files have a non-null id.
        if (entry.id === null) {
          queue.push(childPath);
        } else {
          paths.push(childPath);
        }
      }

      if (data.length < PAGE) break;
      offset += data.length;
    }
  }

  return paths;
}

async function main(): Promise<void> {
  let deleted = 0;
  let failed = 0;

  const allPaths = await listAllObjects(PREFIX);

  if (allPaths.length === 0) {
    console.log(`Cleanup complete. Deleted ~0 objects from ${BUCKET}/${PREFIX}/. Errors: 0.`);
    return;
  }

  // Delete in batches to keep request payloads reasonable.
  for (let i = 0; i < allPaths.length; i += PAGE) {
    const batch = allPaths.slice(i, i + PAGE);
    const { error: rmError } = await supabase.storage.from(BUCKET).remove(batch);
    if (rmError) {
      console.error(`remove batch failed (${batch.length} files): ${rmError.message}`);
      failed += batch.length;
    } else {
      deleted += batch.length;
    }
  }

  console.log(
    `Cleanup complete. Deleted ~${deleted} objects from ${BUCKET}/${PREFIX}/. Errors: ${failed}.`,
  );
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`fatal: ${message}`);
  process.exit(1);
});
