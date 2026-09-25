"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { requireFeatureContext } from "@/lib/auth/features";
import { assertOwner } from "@/lib/auth/roles";
import { buildFacebookAdsOAuthUrl } from "@/lib/connections/oauth";
import {
  BOOKING_CONVERSION_EVENT_NAME,
  buildConversionReadiness,
} from "@/lib/campaigns/conversion-readiness";
import { getMetaAdAccountTokens, storeMetaAdAccountToken } from "@/lib/meta/ad-account-tokens";
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

export interface AdAccountSetupStatus {
  connected: boolean;
  setupComplete: boolean;
  tokenExpiringSoon: boolean;
  metaPixelId: string | null;
  conversionEventName: string;
  conversionOptimisationEnabled: boolean;
  conversionReady: boolean;
  conversionIssues: string[];
  conversionsApiConfigured: boolean;
}

function normalizeMetaAccountId(value: string): string | null {
  const trimmed = value.trim();
  if (/^act_\d+$/.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `act_${trimmed}`;
  return null;
}

/**
 * Creates a state token in oauth_states and returns the Facebook Ads OAuth URL.
 */
export async function startAdsOAuth(): Promise<{ url: string }> {
  const adsCtx = await requireFeatureContext('paidAds');
  assertOwner(adsCtx);
  const { accountId } = adsCtx;
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
  const adsCtx = await requireFeatureContext('paidAds');
  assertOwner(adsCtx);
  const { accountId } = adsCtx;
  const supabase = createServiceSupabaseClient();

  let accessToken: string | null;
  try {
    ({ accessToken } = await getMetaAdAccountTokens(supabase, accountId));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not load the ads token." };
  }

  if (!accessToken) {
    return { success: false, error: "No ads token found." };
  }

  try {
    const graphBase = getMetaGraphApiBase();
    const params = new URLSearchParams({
      fields: "id,name,currency,timezone_name",
      access_token: accessToken,
    });

    const response = await fetch(`${graphBase}/me/adaccounts?${params.toString()}`);
    const json = (await safeJson(response)) as { data?: AdAccountApiEntry[] } | null;

    if (!response.ok) {
      const message = resolveGraphError(json);
      return { success: false, error: message };
    }

    const raw = Array.isArray(json?.data) ? json.data : [];
    const accounts: AdAccountOption[] = raw
      .map((entry) => {
        const id = normalizeMetaAccountId(entry.id);
        if (!id) return null;

        return {
          id,
          name: entry.name,
          currency: entry.currency,
          timezoneName: entry.timezone_name,
        } satisfies AdAccountOption;
      })
      .filter((entry): entry is AdAccountOption => Boolean(entry));

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
  const normalizedMetaAccountId = normalizeMetaAccountId(metaAccountId);

  if (!normalizedMetaAccountId) {
    return { error: "Invalid ad account ID format." };
  }

  const adsCtx = await requireFeatureContext('paidAds');
  assertOwner(adsCtx);
  const { accountId } = adsCtx;
  const supabase = createServiceSupabaseClient();

  let accessToken: string | null;
  try {
    ({ accessToken } = await getMetaAdAccountTokens(supabase, accountId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the ads token.";
    console.error("[ads] failed to load Meta Ads token before account selection", {
      accountId,
      error: message,
    });
    return { error: message };
  }

  if (!accessToken) {
    return { error: "No ads token found." };
  }

  try {
    const graphBase = getMetaGraphApiBase();
    const params = new URLSearchParams({
      fields: "id,currency,timezone_name",
      access_token: accessToken,
    });

    const response = await fetch(
      `${graphBase}/${normalizedMetaAccountId}?${params.toString()}`,
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
          meta_account_id: normalizedMetaAccountId,
          currency,
          timezone,
          setup_complete: true,
        },
        { onConflict: "account_id" },
      );

    if (upsertError) {
      console.error("[ads] failed to save selected Meta ad account", {
        accountId,
        metaAccountId: normalizedMetaAccountId,
        error: upsertError,
      });
      return { error: upsertError.message };
    }

    revalidatePath("/connections");
    revalidatePath("/campaigns");

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
export async function getAdAccountSetupStatus(): Promise<AdAccountSetupStatus> {
  const { accountId } = await requireFeatureContext('paidAds');
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("meta_ad_accounts")
    .select("setup_complete, token_expires_at, meta_pixel_id, conversion_event_name, conversion_optimisation_enabled")
    .eq("account_id", accountId)
    .maybeSingle<{
      setup_complete: boolean;
      token_expires_at: string | null;
      meta_pixel_id: string | null;
      conversion_event_name: string | null;
      conversion_optimisation_enabled: boolean | null;
    }>();

  if (error) {
    console.error("[ads] failed to load Meta Ads setup status", {
      accountId,
      error,
    });
    return buildEmptyAdAccountStatus();
  }

  if (!data) {
    return buildEmptyAdAccountStatus();
  }

  let tokens: { accessToken: string | null; conversionsApiToken: string | null };
  try {
    tokens = await getMetaAdAccountTokens(supabase, accountId);
  } catch (tokenError) {
    // An unreadable token is shown as disconnected, which prompts a reconnect.
    console.error("[ads] failed to load Meta Ads tokens for setup status", {
      accountId,
      error: tokenError instanceof Error ? tokenError.message : tokenError,
    });
    tokens = { accessToken: null, conversionsApiToken: null };
  }

  const connected = Boolean(tokens.accessToken);
  const setupComplete = Boolean(data.setup_complete);
  const conversionReadiness = buildConversionReadiness(data);

  let tokenExpiringSoon = false;
  if (data.token_expires_at) {
    const expiresAt = new Date(data.token_expires_at).getTime();
    const warnThreshold = Date.now() + TOKEN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
    tokenExpiringSoon = expiresAt <= warnThreshold;
  }

  return {
    connected,
    setupComplete,
    tokenExpiringSoon,
    metaPixelId: conversionReadiness.pixelId,
    conversionEventName: conversionReadiness.eventName,
    conversionOptimisationEnabled: conversionReadiness.enabled,
    conversionReady: conversionReadiness.ready,
    conversionIssues: conversionReadiness.issues,
    conversionsApiConfigured: Boolean(tokens.conversionsApiToken),
  };
}

export async function updateAdAccountConversionSettings(input: {
  metaPixelId: string;
  conversionsApiAccessToken?: string;
}): Promise<{ success?: boolean; error?: string }> {
  const pixelId = input.metaPixelId.trim();
  const capiToken = input.conversionsApiAccessToken?.trim();

  if (!/^\d{5,30}$/.test(pixelId)) {
    return { error: "Enter the numeric Meta pixel ID for the venue." };
  }

  if (capiToken !== undefined && capiToken.length > 0 && capiToken.length < 20) {
    return { error: "Enter the full Meta Conversions API access token, or leave it blank to keep the existing token." };
  }

  const adsCtx = await requireFeatureContext('paidAds');
  assertOwner(adsCtx);
  const { accountId } = adsCtx;
  const supabase = createServiceSupabaseClient();

  const { data: current, error: fetchError } = await supabase
    .from("meta_ad_accounts")
    .select("setup_complete")
    .eq("account_id", accountId)
    .maybeSingle<{ setup_complete: boolean }>();

  if (fetchError) {
    return { error: fetchError.message };
  }

  if (!current?.setup_complete) {
    return { error: "Complete Meta Ads account setup before adding conversion tracking." };
  }

  const { error: updateError } = await supabase
    .from("meta_ad_accounts")
    .update({
      meta_pixel_id: pixelId,
      conversion_event_name: BOOKING_CONVERSION_EVENT_NAME,
      conversion_optimisation_enabled: true,
    })
    .eq("account_id", accountId);

  if (updateError) {
    return { error: updateError.message };
  }

  if (capiToken) {
    try {
      await storeMetaAdAccountToken(supabase, accountId, "conversions_api", capiToken);
    } catch (storeError) {
      return { error: storeError instanceof Error ? storeError.message : "Could not save the Conversions API token." };
    }

    await skipSupersededCapiRecommendations(supabase, accountId);
  }

  revalidatePath("/connections");
  revalidatePath("/campaigns");

  return { success: true };
}

async function skipSupersededCapiRecommendations(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  accountId: string,
) {
  const { error } = await supabase
    .from("meta_optimisation_actions")
    .update({
      status: "skipped",
      error: "Superseded by updated Meta CAPI configuration.",
    })
    .eq("account_id", accountId)
    .eq("status", "planned")
    .eq("action_type", "tracking_issue")
    .contains("recommendation_payload", { category: "missing_capi_token" });

  if (error) {
    console.error("[ads] failed to skip superseded CAPI recommendations", {
      accountId,
      error,
    });
  }
}

function buildEmptyAdAccountStatus(): AdAccountSetupStatus {
  return {
    connected: false,
    setupComplete: false,
    tokenExpiringSoon: false,
    metaPixelId: null,
    conversionEventName: BOOKING_CONVERSION_EVENT_NAME,
    conversionOptimisationEnabled: false,
    conversionReady: false,
    conversionIssues: ["Connect Meta Ads before configuring booking optimisation."],
    conversionsApiConfigured: false,
  };
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
