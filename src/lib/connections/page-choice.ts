/**
 * Server-side hand-off between the OAuth callback and the owner's Page choice.
 *
 * One oauth_states row per pending choice (no schema change):
 *   state        random 32-byte reference, the only thing the browser gets
 *   account_id   the brand that started the flow
 *   provider     facebook | instagram
 *   redirect_to  PAGE_CHOICE_PATH
 *   auth_code    AES-256-GCM payload (token vault): the Meta user token, its
 *                expiry, the Meta user id, the signed-in user id and the Page
 *                list for display. No Page token is stored.
 *   expires_at   10 minutes;  used_at  set once, when the owner picks
 *
 * created_by stays empty on purpose: production's oauth_states_select and
 * oauth_states_update RLS policies let a signed-in user read and update rows
 * whose created_by is their own id, which would let them reset used_at or
 * extend expires_at. The app reaches this table only with the service role.
 *
 * A Change Page OAuth state row also carries redirect_to = PAGE_CHOICE_PATH
 * (it means "always show the chooser"), but never an auth_code. The callback
 * only accepts rows without an auth_code and this module only accepts rows
 * with one, so neither kind can stand in for the other.
 */

import { randomBytes } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { canPostToFacebook, canPostToInstagram, type ManagedPage } from "@/lib/connections/page-selection";
import { decrypt, encrypt } from "@/lib/token-vault";

export const PAGE_CHOICE_PATH = "/connections/choose-page";
export const PAGE_CHOICE_TTL_MS = 10 * 60 * 1000;

/** base64url of 32 random bytes. Anything else is refused before a query runs. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const providerSchema = z.enum(["facebook", "instagram"]);

const optionSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  instagramUsername: z.string().nullable(),
  hasInstagram: z.boolean(),
  canPostToFacebook: z.boolean(),
  canPostToInstagram: z.boolean(),
});

const payloadSchema = z.object({
  version: z.literal(1),
  userId: z.string().min(1),
  accountId: z.string().min(1),
  provider: providerSchema,
  changePage: z.boolean(),
  userAccessToken: z.string().min(1),
  expiresAt: z.string().nullable(),
  metaUserId: z.string().nullable(),
  currentPageId: z.string().nullable(),
  instagramPageId: z.string().nullable(),
  pages: z.array(optionSchema),
});

const encryptedSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  keyVersion: z.number().int().positive(),
});

/** One Page as the chooser shows it. Safe for the browser: no token. */
export type PageChoiceOption = z.infer<typeof optionSchema>;

export type PageChoicePayload = z.infer<typeof payloadSchema>;

export interface PendingPageChoice {
  rowId: string;
  expiresAt: string;
  payload: PageChoicePayload;
}

export type PageChoiceFailure = "not_found" | "invalid" | "forbidden" | "used" | "expired" | "lookup_failed";

export type ReadPageChoiceResult =
  | { ok: true; choice: PendingPageChoice }
  | { ok: false; reason: PageChoiceFailure; provider: "facebook" | "instagram" | null; changePage: boolean };

/** What the chooser may show for a Page, and whether it can be picked: never its token. */
export function toPageChoiceOption(page: ManagedPage): PageChoiceOption {
  return {
    id: page.id,
    name: page.name,
    instagramUsername: page.instagram?.username ?? null,
    hasInstagram: Boolean(page.instagram),
    canPostToFacebook: canPostToFacebook(page),
    canPostToInstagram: canPostToInstagram(page),
  };
}

interface PageChoiceRow {
  id: string;
  provider: string;
  account_id: string | null;
  auth_code: string | null;
  used_at: string | null;
  expires_at: string | null;
}

/**
 * Stores a pending choice and returns its reference. Throws when the payload
 * cannot be encrypted (for example TOKEN_VAULT_KEY missing) or the insert fails.
 */
export async function createPageChoice(
  supabase: SupabaseClient,
  input: Omit<PageChoicePayload, "version">,
): Promise<string> {
  const payload: PageChoicePayload = payloadSchema.parse({ version: 1, ...input });
  const token = randomBytes(32).toString("base64url");
  const sealed = JSON.stringify(encrypt(JSON.stringify(payload)));

  const { error } = await supabase.from("oauth_states").insert({
    state: token,
    provider: payload.provider,
    account_id: payload.accountId,
    redirect_to: PAGE_CHOICE_PATH,
    auth_code: sealed,
    expires_at: new Date(Date.now() + PAGE_CHOICE_TTL_MS).toISOString(),
  });

  if (error) {
    throw new Error(`Could not store the Page choice: ${error.message}`);
  }
  return token;
}

/**
 * Reads a pending choice for the signed-in user. Only rows in brands they own
 * are looked at; the decrypted payload must name the same user, brand and
 * platform as the row.
 */
export async function readPageChoice(
  supabase: SupabaseClient,
  { token, userId, ownedAccountIds }: { token: string; userId: string; ownedAccountIds: string[] },
): Promise<ReadPageChoiceResult> {
  const refuse = (
    reason: PageChoiceFailure,
    provider: "facebook" | "instagram" | null = null,
    changePage = false,
  ): ReadPageChoiceResult => ({ ok: false, reason, provider, changePage });

  if (!TOKEN_PATTERN.test(token) || !ownedAccountIds.length) {
    return refuse("not_found");
  }

  const { data, error } = await supabase
    .from("oauth_states")
    .select("id, provider, account_id, auth_code, used_at, expires_at")
    .eq("state", token)
    .eq("redirect_to", PAGE_CHOICE_PATH)
    .in("account_id", ownedAccountIds)
    .maybeSingle<PageChoiceRow>();

  if (error) {
    return refuse("lookup_failed");
  }
  if (!data) {
    return refuse("not_found");
  }

  const rowProvider = providerSchema.safeParse(data.provider);
  const provider = rowProvider.success ? rowProvider.data : null;

  if (data.used_at) {
    return refuse("used", provider);
  }
  if (!data.auth_code || !data.account_id || !provider) {
    return refuse("invalid");
  }

  const payload = openPayload(data.auth_code);
  if (!payload) {
    return refuse("invalid");
  }
  if (payload.userId !== userId || payload.accountId !== data.account_id || payload.provider !== provider) {
    return refuse("forbidden");
  }
  if (!data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
    return refuse("expired", provider, payload.changePage);
  }

  return { ok: true, choice: { rowId: data.id, expiresAt: data.expires_at, payload } };
}

/**
 * Marks the choice used and drops its encrypted payload in one conditional
 * update. True only for the one request that wins; a double submit, a replay
 * or an expired row gets false. Throws when the update itself fails.
 */
export async function claimPageChoice(supabase: SupabaseClient, choice: PendingPageChoice): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("oauth_states")
    .update({ used_at: now, auth_code: null })
    .eq("id", choice.rowId)
    .eq("account_id", choice.payload.accountId)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id");

  if (error) {
    throw new Error(`Could not claim the Page choice: ${error.message}`);
  }
  return Array.isArray(data) && data.length === 1;
}

function openPayload(sealed: string): PageChoicePayload | null {
  try {
    const encrypted = encryptedSchema.parse(JSON.parse(sealed));
    const parsed = payloadSchema.safeParse(JSON.parse(decrypt(encrypted)));
    return parsed.success ? parsed.data : null;
  } catch {
    // Wrong key, tampered ciphertext or malformed JSON: never trusted.
    return null;
  }
}
