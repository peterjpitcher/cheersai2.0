"use server";

import { randomUUID } from "crypto";

import { requireAuthContext } from "@/lib/auth/server";
import { buildFacebookAdsOAuthUrl } from "@/lib/connections/oauth";
import { getMetaGraphApiBase } from "@/lib/meta/graph";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const TOKEN_EXPIRY_WARNING_DAYS = 7;

interface AdAccountApiEntry {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
}

export interface AdAccountOption {
  id: string;
  name: string;
  currency: string;
  timezoneName: string;
}

/**
 * Creates a state token in oauth_states and returns the Facebook Ads OAuth URL.
 */
export async function startAdsOAuth(): Promise<{ url: string }> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const state = randomUUID();

  const { error } = await supabase.from("oauth_states").insert({
    provider: "facebook",
    state,
    account_id: accountId,
  });

  if (error) {
    throw error;
  }

  const url = buildFacebookAdsOAuthUrl(state);
  return { url };
}

/**
 * Fetches the list of ad accounts available on the stored Meta access token.
 */
export async function fetchAdAccounts(): Promise<
  { success: true; accounts: AdAccountOption[] } | { success: false; error: string }
> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: adAccount, error: fetchError } = await supabase
    .from("meta_ad_accounts")
    .select("access_token")
    .eq("account_id", accountId)
    .maybeSingle<{ access_token: string }>();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  if (!adAccount?.access_token) {
    return { success: false, error: "No ads token found." };
  }

  try {
    const graphBase = getMetaGraphApiBase();
    const params = new URLSearchParams({
      fields: "id,name,currency,timezone_name",
      access_token: adAccount.access_token,
    });

    const response = await fetch(`${graphBase}/me/adaccounts?${params.toString()}`);
    const json = (await safeJson(response)) as { data?: AdAccountApiEntry[] } | null;

    if (!response.ok) {
      const message = resolveGraphError(json);
      return { success: false, error: message };
    }

    const raw = Array.isArray(json?.data) ? json.data : [];
    const accounts: AdAccountOption[] = raw.map((entry) => ({
      id: entry.id,
      name: entry.name,
      currency: entry.currency,
      timezoneName: entry.timezone_name,
    }));

    return { success: true, accounts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error fetching ad accounts.";
    return { success: false, error: message };
  }
}

/**
 * Selects an ad account, fetches its details, and marks setup as complete.
 */
export async function selectAdAccount(
  metaAccountId: string,
): Promise<{ success?: boolean; error?: string }> {
  if (!/^act_\d+$/.test(metaAccountId)) {
    return { error: 'Invalid ad account ID format.' };
  }

  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data: adAccount, error: fetchError } = await supabase
    .from("meta_ad_accounts")
    .select("access_token")
    .eq("account_id", accountId)
    .maybeSingle<{ access_token: string }>();

  if (fetchError) {
    return { error: fetchError.message };
  }

  if (!adAccount?.access_token) {
    return { error: "No ads token found." };
  }

  try {
    const graphBase = getMetaGraphApiBase();
    const params = new URLSearchParams({
      fields: "id,currency,timezone_name",
      access_token: adAccount.access_token,
    });

    const response = await fetch(
      `${graphBase}/${metaAccountId}?${params.toString()}`,
    );
    const json = (await safeJson(response)) as {
      id?: string;
      currency?: string;
      timezone_name?: string;
    } | null;

    let currency = "GBP";
    let timezone = "Europe/London";

    if (response.ok && json) {
      if (typeof json.currency === "string" && json.currency.length) {
        currency = json.currency;
      }
      if (typeof json.timezone_name === "string" && json.timezone_name.length) {
        timezone = json.timezone_name;
      }
    } else {
      console.warn(
        "[ads] failed to fetch account details, using defaults",
        resolveGraphError(json),
      );
    }

    const { error: upsertError } = await supabase
      .from("meta_ad_accounts")
      .upsert(
        {
          account_id: accountId,
          meta_account_id: metaAccountId,
          currency,
          timezone,
          access_token: adAccount.access_token,
          setup_complete: true,
        },
        { onConflict: "account_id" },
      );

    if (upsertError) {
      return { error: upsertError.message };
    }

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error selecting ad account.";
    return { error: message };
  }
}

/**
 * Returns the current setup status of the Meta Ads connection.
 */
export async function getAdAccountSetupStatus(): Promise<{
  connected: boolean;
  setupComplete: boolean;
  tokenExpiringSoon: boolean;
}> {
  const { accountId } = await requireAuthContext();
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("meta_ad_accounts")
    .select("setup_complete, token_expires_at, access_token")
    .eq("account_id", accountId)
    .maybeSingle<{
      setup_complete: boolean;
      token_expires_at: string | null;
      access_token: string;
    }>();

  if (error || !data) {
    return { connected: false, setupComplete: false, tokenExpiringSoon: false };
  }

  const connected = Boolean(data.access_token);
  const setupComplete = Boolean(data.setup_complete);

  let tokenExpiringSoon = false;
  if (data.token_expires_at) {
    const expiresAt = new Date(data.token_expires_at).getTime();
    const warnThreshold = Date.now() + TOKEN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
    tokenExpiringSoon = expiresAt <= warnThreshold;
  }

  return { connected, setupComplete, tokenExpiringSoon };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveGraphError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (
      payload as { error: { message?: string; type?: string; code?: number } }
    ).error;
    const message = err?.message ?? "Unknown Graph API error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return `${type}${message}${code}`;
  }
  return "Facebook Ads API request failed";
}
