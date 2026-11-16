/**
 * Server-side hand-off between the Google OAuth callback and the owner's
 * location choice. The same pattern as the Facebook Page choice
 * (./page-choice.ts), with its own payload and its own marker.
 *
 * One oauth_states row per pending choice (no schema change):
 *   state        random 32-byte reference, the only thing the browser gets
 *   account_id   the brand that started the flow
 *   provider     gbp
 *   redirect_to  GOOGLE_LOCATION_CHOICE_PATH
 *   auth_code    AES-256-GCM payload (token vault): the Google access and
 *                refresh tokens, the expiry, the scopes, the signed-in user id
 *                and the locations for display
 *   created_by   the signed-in user who logged in; only they can read or pick
 *   expires_at   10 minutes;  used_at  set once, when the owner picks
 *
 * Until a location is chosen the Google tokens exist ONLY in that encrypted
 * payload. Nothing is written to social_connections or token_vault.
 *
 * The Facebook Page choice reads only rows marked PAGE_CHOICE_PATH and the
 * OAuth callback only rows without an auth_code, so neither can stand in for
 * a Google location choice, or the other way round.
 */

import { randomBytes } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  GOOGLE_LOCATION_CHOICE_PATH,
  GOOGLE_LOCATION_ID_PATTERN,
  GOOGLE_PROVIDER,
} from "@/lib/connections/google-messages";
import { createLogger } from "@/lib/logging";
import { decrypt, encrypt } from "@/lib/token-vault";

const logger = createLogger("connections");

export const GOOGLE_LOCATION_CHOICE_TTL_MS = 10 * 60 * 1000;

/** base64url of 32 random bytes. Anything else is refused before a query runs. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const locationSchema = z.object({
  id: z.string().regex(GOOGLE_LOCATION_ID_PATTERN),
  title: z.string().min(1),
  address: z.string().nullable(),
  accountName: z.string().nullable(),
  placeId: z.string().nullable(),
});

const payloadSchema = z.object({
  version: z.literal(1),
  userId: z.string().min(1),
  accountId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** When the access token expires. */
  expiresAt: z.string().min(1),
  scopes: z.array(z.string()),
  /** Some of the login's accounts could not be listed. */
  incomplete: z.boolean(),
  /** The location this brand is connected to now, if any. */
  currentLocationId: z.string().nullable(),
  locations: z.array(locationSchema).min(1),
});

const encryptedSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  keyVersion: z.number().int().positive(),
});

export type GoogleLocationChoicePayload = z.infer<typeof payloadSchema>;

export interface PendingGoogleLocationChoice {
  rowId: string;
  expiresAt: string;
  payload: GoogleLocationChoicePayload;
}

export type GoogleLocationChoiceFailure = "not_found" | "invalid" | "forbidden" | "used" | "expired" | "lookup_failed";

export type ReadGoogleLocationChoiceResult =
  | { ok: true; choice: PendingGoogleLocationChoice }
  | { ok: false; reason: GoogleLocationChoiceFailure };

interface ChoiceRow {
  id: string;
  provider: string;
  account_id: string | null;
  auth_code: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_by: string | null;
}

/**
 * Stores a pending choice and returns its reference. Throws when the payload
 * cannot be encrypted (for example TOKEN_VAULT_KEY missing) or the insert fails.
 */
export async function createGoogleLocationChoice(
  supabase: SupabaseClient,
  input: Omit<GoogleLocationChoicePayload, "version">,
): Promise<string> {
  const payload: GoogleLocationChoicePayload = payloadSchema.parse({ version: 1, ...input });
  const token = randomBytes(32).toString("base64url");
  const sealed = JSON.stringify(encrypt(JSON.stringify(payload)));

  const { error } = await supabase.from("oauth_states").insert({
    state: token,
    provider: GOOGLE_PROVIDER,
    account_id: payload.accountId,
    created_by: payload.userId,
    redirect_to: GOOGLE_LOCATION_CHOICE_PATH,
    auth_code: sealed,
    expires_at: new Date(Date.now() + GOOGLE_LOCATION_CHOICE_TTL_MS).toISOString(),
  });

  if (error) {
    throw new Error(`Could not store the location choice: ${error.message}`);
  }
  return token;
}

/**
 * Reads a pending choice for the signed-in user. Only rows in brands they own
 * are looked at; the row's created_by must be the signed-in user, and the
 * decrypted payload must name the same user and brand as the row. An expired
 * row has its payload (the Google tokens) dropped on the spot.
 */
export async function readGoogleLocationChoice(
  supabase: SupabaseClient,
  { token, userId, ownedAccountIds }: { token: string; userId: string; ownedAccountIds: string[] },
): Promise<ReadGoogleLocationChoiceResult> {
  const refuse = (reason: GoogleLocationChoiceFailure): ReadGoogleLocationChoiceResult => ({ ok: false, reason });

  if (!TOKEN_PATTERN.test(token) || !ownedAccountIds.length) {
    return refuse("not_found");
  }

  const { data, error } = await supabase
    .from("oauth_states")
    .select("id, provider, account_id, auth_code, used_at, expires_at, created_by")
    .eq("state", token)
    .eq("provider", GOOGLE_PROVIDER)
    .eq("redirect_to", GOOGLE_LOCATION_CHOICE_PATH)
    .in("account_id", ownedAccountIds)
    .maybeSingle<ChoiceRow>();

  if (error) {
    return refuse("lookup_failed");
  }
  if (!data) {
    return refuse("not_found");
  }
  if (data.used_at) {
    return refuse("used");
  }
  if (!data.account_id) {
    return refuse("invalid");
  }

  if (!data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
    // Expired: drop the encrypted Google tokens now rather than leaving them
    // for the retention cron.
    if (data.auth_code) {
      await dropPayload(supabase, data.id, data.account_id);
    }
    return refuse("expired");
  }

  if (!data.auth_code) {
    return refuse("invalid");
  }
  const payload = openPayload(data.auth_code);
  if (!payload) {
    return refuse("invalid");
  }
  // Bound to the person who logged in. A row without created_by matches nobody.
  if (data.created_by !== userId || payload.userId !== userId || payload.accountId !== data.account_id) {
    return refuse("forbidden");
  }

  return { ok: true, choice: { rowId: data.id, expiresAt: data.expires_at, payload } };
}

/** Best effort: a failure leaves the payload for the retention cron, and is logged. */
async function dropPayload(supabase: SupabaseClient, rowId: string, accountId: string): Promise<void> {
  const { error } = await supabase
    .from("oauth_states")
    .update({ auth_code: null })
    .eq("id", rowId)
    .eq("account_id", accountId)
    .is("used_at", null);

  if (error) {
    logger.warn("could not clear an expired location choice", { accountId, message: error.message });
  }
}

/**
 * Marks the choice used and drops its encrypted payload in one conditional
 * update, only on the row started by the user readGoogleLocationChoice
 * checked. True only for the one request that wins; a double submit, a replay
 * or an expired row gets false. Throws when the update itself fails.
 *
 * Also how a refused choice is discarded: once claimed, the tokens are gone.
 */
export async function claimGoogleLocationChoice(
  supabase: SupabaseClient,
  choice: PendingGoogleLocationChoice,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("oauth_states")
    .update({ used_at: now, auth_code: null })
    .eq("id", choice.rowId)
    .eq("account_id", choice.payload.accountId)
    .eq("created_by", choice.payload.userId)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id");

  if (error) {
    throw new Error(`Could not claim the location choice: ${error.message}`);
  }
  return Array.isArray(data) && data.length === 1;
}

function openPayload(sealed: string): GoogleLocationChoicePayload | null {
  try {
    const encrypted = encryptedSchema.parse(JSON.parse(sealed));
    const parsed = payloadSchema.safeParse(JSON.parse(decrypt(encrypted)));
    return parsed.success ? parsed.data : null;
  } catch {
    // Wrong key, tampered ciphertext or malformed JSON: never trusted.
    return null;
  }
}
