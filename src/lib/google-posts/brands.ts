/**
 * Which brands the Google cron works for, and the checks repeated before each
 * send. Server only; service-role client, every query scoped by account_id.
 *
 * Both must hold (decision D10): the brand's switch
 * (accounts.google_posts_enabled, read with the service client because a cron
 * has no signed-in user) and an ACTIVE Google connection.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GOOGLE_LOCATION_ID_PATTERN, GOOGLE_PROVIDER } from "@/lib/connections/google-messages";

export interface GoogleBrand {
  accountId: string;
  connectionId: string;
  /** accounts/{a}/locations/{l}: where new versions go. */
  localPostParent: string;
  /**
   * When the connection was last made (metadata.connectedAt). Facebook posts
   * created after it get a Google version automatically (D8). Null means
   * unknown, and then nothing is created automatically.
   */
  connectedAt: string | null;
}

interface ConnectionRow {
  id: string;
  account_id: string;
  status: string;
  platform_account_id: string | null;
  metadata: Record<string, unknown> | null;
}

function toBrand(row: ConnectionRow): GoogleBrand | null {
  const fromMetadata = typeof row.metadata?.localPostParent === "string" ? row.metadata.localPostParent : null;
  const parent = fromMetadata ?? row.platform_account_id;
  if (!parent || !GOOGLE_LOCATION_ID_PATTERN.test(parent)) return null;
  const connectedAt = typeof row.metadata?.connectedAt === "string" && !Number.isNaN(Date.parse(row.metadata.connectedAt))
    ? row.metadata.connectedAt
    : null;
  return { accountId: row.account_id, connectionId: row.id, localPostParent: parent, connectedAt };
}

/** Brands with the switch on and an active Google connection with a usable location. */
export async function listGoogleBrands(db: SupabaseClient): Promise<GoogleBrand[]> {
  const { data: accounts, error: accountsError } = await db
    .from("accounts")
    .select("id")
    .eq("google_posts_enabled", true);
  if (accountsError) throw new Error(`Google brands: accounts lookup failed: ${accountsError.message}`);
  const ids = ((accounts ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (!ids.length) return [];

  const { data: connections, error: connectionsError } = await db
    .from("social_connections")
    .select("id, account_id, status, platform_account_id, metadata")
    .eq("provider", GOOGLE_PROVIDER)
    .eq("status", "active")
    .in("account_id", ids);
  if (connectionsError) throw new Error(`Google brands: connection lookup failed: ${connectionsError.message}`);

  return ((connections ?? []) as ConnectionRow[])
    .filter((row) => ids.includes(row.account_id))
    .map(toBrand)
    .filter((brand): brand is GoogleBrand => brand !== null);
}

export type GoogleBrandCheck =
  | { ok: true; brand: GoogleBrand }
  | { ok: false; reason: "switched_off" | "connection_missing" | "lookup_failed" };

/** The switch and the connection for one brand, read again just before a send. */
export async function checkGoogleBrand(db: SupabaseClient, accountId: string): Promise<GoogleBrandCheck> {
  const { data: account, error: accountError } = await db
    .from("accounts")
    .select("id, google_posts_enabled")
    .eq("id", accountId)
    .maybeSingle<{ id: string; google_posts_enabled: boolean | null }>();
  if (accountError) return { ok: false, reason: "lookup_failed" };
  if (!account || account.google_posts_enabled !== true) return { ok: false, reason: "switched_off" };

  const { data: connection, error: connectionError } = await db
    .from("social_connections")
    .select("id, account_id, status, platform_account_id, metadata")
    .eq("account_id", accountId)
    .eq("provider", GOOGLE_PROVIDER)
    .maybeSingle<ConnectionRow>();
  if (connectionError) return { ok: false, reason: "lookup_failed" };
  if (!connection || connection.status !== "active") return { ok: false, reason: "connection_missing" };
  const brand = toBrand(connection);
  return brand ? { ok: true, brand } : { ok: false, reason: "connection_missing" };
}
