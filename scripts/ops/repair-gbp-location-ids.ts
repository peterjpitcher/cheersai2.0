#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";

import {
  GbpRateLimitError,
  resolveGoogleLocation,
} from "../../src/lib/gbp/business-info";
import {
  isCanonicalGbpLocationId,
  normalizeCanonicalGbpLocationId,
} from "../../src/lib/gbp/location-id";
import { refreshGoogleAccessToken } from "../../src/lib/gbp/reviews";

type ConnectionStatus = "active" | "expiring" | "needs_action" | null;

type ConnectionRow = {
  id: string;
  account_id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
  display_name: string | null;
  status: ConnectionStatus;
};

interface SocialConnectionsClient {
  from(table: "social_connections"): {
    update(payload: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: unknown }>;
    };
  };
}

interface CliOptions {
  accountId: string | null;
  dryRun: boolean;
  sleepMs: number;
}

const DEFAULT_SLEEP_MS = 250;

function parseArgs(argv: string[]): CliOptions {
  let accountId: string | null = null;
  let dryRun = false;
  let sleepMs = DEFAULT_SLEEP_MS;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--account-id") {
      accountId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith("--account-id=")) {
      accountId = arg.slice("--account-id=".length) || null;
      continue;
    }
    if (arg === "--sleep-ms") {
      sleepMs = parsePositiveInt(argv[i + 1], DEFAULT_SLEEP_MS);
      i += 1;
      continue;
    }
    if (arg.startsWith("--sleep-ms=")) {
      sleepMs = parsePositiveInt(arg.slice("--sleep-ms=".length), DEFAULT_SLEEP_MS);
    }
  }

  return { accountId, dryRun, sleepMs };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function isExpiredOrExpiringSoon(expiresAt: string | null) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date(Date.now() + 5 * 60 * 1000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { accountId, dryRun, sleepMs } = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Supabase credentials missing – set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let query = supabase
    .from("social_connections")
    .select("id, account_id, access_token, refresh_token, expires_at, metadata, display_name, status")
    .eq("provider", "gbp");

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  const { data, error } = await query.returns<ConnectionRow[]>();
  if (error) {
    console.error("Failed to load GBP connections", error);
    process.exit(1);
  }

  const connections = (data ?? []).filter((connection) => {
    const locationId = getString(connection.metadata?.locationId);
    return !isCanonicalGbpLocationId(locationId);
  });

  if (!connections.length) {
    console.log("No GBP connections need canonical location repair.");
    return;
  }

  const summary = {
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const connection of connections) {
    const currentLocationId = getString(connection.metadata?.locationId);
    try {
      const locallyNormalized = normalizeCanonicalGbpLocationId(currentLocationId);
      if (locallyNormalized) {
        await persistConnectionUpdate({
          supabase,
          connection,
          dryRun,
          payload: {
            metadata: { ...(connection.metadata ?? {}), locationId: locallyNormalized },
            updated_at: new Date().toISOString(),
            ...(connection.status === "needs_action" ? { status: "active" } : {}),
          },
          reason: `normalized ${currentLocationId} to ${locallyNormalized}`,
        });
        summary.updated += 1;
        if (sleepMs > 0) await sleep(sleepMs);
        continue;
      }

      let token = connection.access_token;
      let expiresAt = connection.expires_at;

      if ((!token || isExpiredOrExpiringSoon(expiresAt)) && connection.refresh_token) {
        const refreshed = await refreshGoogleAccessToken(connection.refresh_token);
        token = refreshed.accessToken;
        expiresAt = refreshed.expiresAt;
      }

      if (!token) {
        summary.failed += 1;
        console.error(`❌ ${connection.account_id}: cannot repair without an access token or refresh token.`);
        continue;
      }

      const resolved = await resolveGoogleLocation(token, currentLocationId);
      const payload: Record<string, unknown> = {
        metadata: { ...(connection.metadata ?? {}), locationId: resolved.locationId },
        updated_at: new Date().toISOString(),
      };

      if (connection.status === "needs_action") {
        payload.status = "active";
      }
      if (resolved.displayName && resolved.displayName !== connection.display_name) {
        payload.display_name = resolved.displayName;
      }
      if (token !== connection.access_token || expiresAt !== connection.expires_at) {
        payload.access_token = token;
        payload.expires_at = expiresAt;
      }

      await persistConnectionUpdate({
        supabase,
        connection,
        dryRun,
        payload,
        reason: currentLocationId
          ? `repaired ${currentLocationId} to ${resolved.locationId}`
          : `discovered ${resolved.locationId}`,
      });
      summary.updated += 1;
    } catch (error) {
      if (error instanceof GbpRateLimitError) {
        summary.failed += 1;
        const retryAfter = error.retryAfterSeconds ? ` Retry after about ${error.retryAfterSeconds}s.` : "";
        console.error(`❌ ${connection.account_id}: Google Business Profile API quota exceeded.${retryAfter}`);
        console.error(`   ${error.googleDetail}`);
        break;
      }

      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${connection.account_id}: ${message}`);
    }

    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  console.log("\nRepair summary:");
  console.log(`  Updated: ${summary.updated}`);
  console.log(`  Skipped: ${summary.skipped}`);
  console.log(`  Failed: ${summary.failed}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function persistConnectionUpdate({
  supabase,
  connection,
  dryRun,
  payload,
  reason,
}: {
  supabase: SocialConnectionsClient;
  connection: ConnectionRow;
  dryRun: boolean;
  payload: Record<string, unknown>;
  reason: string;
}) {
  if (dryRun) {
    console.log(`DRY RUN: ${connection.account_id} would be updated (${reason}).`);
    return;
  }

  const { error } = await supabase
    .from("social_connections")
    .update(payload)
    .eq("id", connection.id);

  if (error) {
    throw error;
  }

  console.log(`✅ ${connection.account_id} updated (${reason}).`);
}

main().catch((error) => {
  console.error("Unexpected failure repairing GBP location IDs", error);
  process.exit(1);
});
