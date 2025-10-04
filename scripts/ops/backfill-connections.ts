#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";

type Provider = "facebook" | "instagram" | "gbp";

type ConnectionStatus = "active" | "expiring" | "needs_action";

type ConnectionRow = {
  id: string;
  account_id: string;
  provider: Provider;
  metadata: Record<string, unknown> | null;
  status: ConnectionStatus;
  access_token: string | null;
  display_name: string | null;
};

type BackfillResult = {
  metadata: Record<string, unknown>;
  displayName?: string | null;
};

const REQUIRED_METADATA: Record<Provider, string> = {
  facebook: "pageId",
  instagram: "igBusinessId",
  gbp: "locationId",
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

async function main() {
  const { data, error } = await supabase
    .from("social_connections")
    .select("id, account_id, provider, metadata, status, access_token, display_name");

  if (error) {
    console.error("Failed to load social connections", error);
    process.exit(1);
  }

  const connections = (data ?? []) as ConnectionRow[];
  if (!connections.length) {
    console.log("No connections found – nothing to backfill.");
    return;
  }

  const summary = {
    updated: 0,
    alreadyComplete: 0,
    failed: 0,
  };
  const failures: string[] = [];

  for (const connection of connections) {
    const requiredKey = REQUIRED_METADATA[connection.provider];
    const existingMetadata = (connection.metadata ?? {}) as Record<string, unknown>;
    const hasKey = typeof existingMetadata[requiredKey] === "string" &&
      (existingMetadata[requiredKey] as string).length > 0;

    if (hasKey) {
      summary.alreadyComplete += 1;
      continue;
    }

    if (!connection.access_token) {
      summary.failed += 1;
      const message = `${connection.provider} connection ${connection.id} has no access token.`;
      failures.push(message);
      console.error(`❌ ${message}`);
      continue;
    }

    try {
      const result = await resolveMetadata(connection, existingMetadata);
      if (!result) {
        summary.alreadyComplete += 1;
        continue;
      }

      const mergedMetadata = { ...existingMetadata, ...result.metadata };
      const updatePayload: Record<string, unknown> = {
        metadata: mergedMetadata,
        updated_at: new Date().toISOString(),
      };

      if (connection.status === "needs_action" && typeof mergedMetadata[requiredKey] === "string") {
        updatePayload.status = "active";
      }

      if (result.displayName && !connection.display_name) {
        updatePayload.display_name = result.displayName;
      }

      const { error: updateError } = await supabase
        .from("social_connections")
        .update(updatePayload)
        .eq("id", connection.id);

      if (updateError) {
        throw updateError;
      }

      summary.updated += 1;
      console.log(`✅ ${connection.provider} connection ${connection.id} updated.`);
    } catch (error) {
      summary.failed += 1;
      const message = normaliseError(error);
      failures.push(`${connection.provider} connection ${connection.id}: ${message}`);
      console.error(`❌ Failed to backfill ${connection.provider} connection ${connection.id}: ${message}`);
    }
  }

  console.log("\nBackfill summary:");
  console.log(`  • Updated: ${summary.updated}`);
  console.log(`  • Already complete: ${summary.alreadyComplete}`);
  console.log(`  • Failed: ${summary.failed}`);

  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exitCode = 1;
  }
}

async function resolveMetadata(
  connection: ConnectionRow,
  existingMetadata: Record<string, unknown>,
): Promise<BackfillResult | null> {
  switch (connection.provider) {
    case "facebook":
      return backfillFacebook(connection.access_token!);
    case "instagram":
      return backfillInstagram(connection.access_token!);
    case "gbp":
      return backfillGoogle(existingMetadata, connection.access_token!);
    default:
      return null;
  }
}

async function backfillFacebook(accessToken: string): Promise<BackfillResult> {
  const url = new URL("https://graph.facebook.com/v19.0/me");
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const json = await safeJson(response);
  if (!response.ok) {
    throw new Error(resolveGraphError(json));
  }

  const pageId = getString(json?.id);
  if (!pageId) {
    throw new Error("Facebook API did not return a Page id");
  }

  const displayName = getString(json?.name);
  return {
    metadata: { pageId },
    displayName: displayName ?? null,
  };
}

async function backfillInstagram(accessToken: string): Promise<BackfillResult> {
  const url = new URL("https://graph.facebook.com/v19.0/me");
  url.searchParams.set("fields", "id,name,instagram_business_account{id,username,name}");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const json = await safeJson(response);
  if (!response.ok) {
    throw new Error(resolveGraphError(json));
  }

  const pageId = getString(json?.id);
  const instagram = json?.instagram_business_account ?? null;
  const instagramId = getString(instagram?.id);

  if (!pageId || !instagramId) {
    throw new Error(
      "Instagram Business Account not linked to the selected Facebook Page. Reconnect via Connections page.",
    );
  }

  const metadata: Record<string, unknown> = {
    pageId,
    igBusinessId: instagramId,
  };

  const username = getString(instagram?.username) ?? getString(instagram?.name) ?? getString(json?.name);
  if (username) {
    metadata.instagramUsername = username;
  }

  return {
    metadata,
    displayName: username ?? null,
  };
}

async function backfillGoogle(
  existingMetadata: Record<string, unknown>,
  accessToken: string,
): Promise<BackfillResult> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const desiredLocationId = getString(existingMetadata.locationId);

  if (desiredLocationId) {
    const locationResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${desiredLocationId}`,
      { headers },
    );
    const locationJson = await safeJson(locationResponse);
    if (locationResponse.ok) {
      return {
        metadata: { locationId: desiredLocationId },
        displayName: getString(locationJson?.title) ?? null,
      };
    }
    console.warn("⚠️ Failed to hydrate stored locationId – will enumerate locations", resolveGoogleError(locationJson));
  }

  const accountsResponse = await fetch(
    "https://mybusinessbusinessinformation.googleapis.com/v1/accounts",
    { headers },
  );
  const accountsJson = await safeJson(accountsResponse);

  if (!accountsResponse.ok) {
    throw new Error(resolveGoogleError(accountsJson));
  }

  const accounts = Array.isArray(accountsJson?.accounts) ? accountsJson.accounts : [];

  for (const account of accounts) {
    const accountName = getString(account?.name);
    if (!accountName) {
      continue;
    }

    const locationsResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?pageSize=100`,
      { headers },
    );
    const locationsJson = await safeJson(locationsResponse);

    if (!locationsResponse.ok) {
      console.warn("⚠️ Failed to list GBP locations", resolveGoogleError(locationsJson));
      continue;
    }

    const locations = Array.isArray(locationsJson?.locations) ? locationsJson.locations : [];
    if (!locations.length) {
      continue;
    }

    const matched = desiredLocationId
      ? locations.find((loc: unknown) => getString((loc as Record<string, unknown>)?.name) === desiredLocationId)
      : locations[0];

    if (!matched) {
      continue;
    }

    const locationId = getString((matched as Record<string, unknown>)?.name);
    if (!locationId) {
      continue;
    }

    return {
      metadata: { locationId },
      displayName: getString((matched as Record<string, unknown>)?.title) ?? null,
    };
  }

  throw new Error("No Google Business Profile locations were returned for this access token.");
}

function normaliseError(error: unknown) {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch (error) {
    console.warn("Failed to parse JSON response", error);
    return null;
  }
}

function getString(value: unknown) {
  return typeof value === "string" && value.length ? value : null;
}

function resolveGraphError(payload: unknown) {
  const error = (payload as { error?: { message?: string; code?: number } })?.error;
  if (error?.message) {
    return error.message;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "Facebook API error";
  }
}

function resolveGoogleError(payload: unknown) {
  const error = (payload as { error?: { message?: string } })?.error;
  if (error?.message) {
    return error.message;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "Google API error";
  }
}

main().catch((error) => {
  console.error("Unexpected failure running backfill", error);
  process.exit(1);
});
