import { env } from "@/env";
import { getMetaGraphApiBase } from "@/lib/meta/graph";
import type { Provider } from "@/lib/connections/oauth";

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
const GRAPH_BASE = getMetaGraphApiBase();

interface ExchangeOptions {
  existingMetadata?: Record<string, unknown> | null;
  existingDisplayName?: string | null;
}

const GOOGLE_LOCATION_CACHE_TTL_MS = 5 * 60 * 1000;
const googleLocationCache = new Map<string, { metadata: { locationId: string }; displayName: string | null; expiresAt: number }>();

interface FacebookPage {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
    name?: string;
  } | null;
}

interface GoogleLocation {
  name?: string;
  title?: string;
}

export interface ProviderTokenExchange {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  displayName?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function exchangeProviderAuthCode(
  provider: Provider,
  authCode: string,
  options: ExchangeOptions = {},
): Promise<ProviderTokenExchange> {
  switch (provider) {
    case "facebook":
    case "instagram":
      return exchangeFacebookFamilyCode(provider, authCode, options.existingMetadata ?? null);
    case "gbp":
      return exchangeGoogleCode(authCode, options.existingMetadata ?? null, options.existingDisplayName ?? null);
    default:
      throw new Error(`Unsupported provider ${provider}`);
  }
}

async function exchangeFacebookFamilyCode(
  provider: "facebook" | "instagram",
  code: string,
  existingMetadata: Record<string, unknown> | null,
): Promise<ProviderTokenExchange> {
  const redirectUri = `${SITE_URL}/api/oauth/${provider}/callback`;
  const params = new URLSearchParams({
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    client_secret: env.server.FACEBOOK_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });

  const shortLivedResponse = await fetch(
    `${GRAPH_BASE}/oauth/access_token?${params.toString()}`,
  );
  const shortJson = await safeJson(shortLivedResponse);

  if (!shortLivedResponse.ok) {
    throw new Error(resolveGraphError(shortJson));
  }

  const shortToken = typeof shortJson?.access_token === "string" ? shortJson.access_token : null;
  const shortExpiresIn = normaliseExpires(shortJson?.expires_in);

  if (!shortToken) {
    throw new Error("Facebook token exchange failed: missing access token");
  }

  let userAccessToken = shortToken;
  let expiresIn = shortExpiresIn;

  try {
    const longLived = await exchangeLongLivedFacebookToken(shortToken);
    userAccessToken = longLived.accessToken;
    if (longLived.expiresIn) {
      expiresIn = longLived.expiresIn;
    }
  } catch (error) {
    console.warn("[connections] failed to obtain long-lived Facebook token", error);
  }

  const expiresAt = expiresIn ? toIsoExpiry(expiresIn) : null;
  const pages = await fetchManagedPages(userAccessToken);

  if (!pages.length) {
    throw new Error("No Facebook Pages found for the connected account.");
  }

  const metadata: Record<string, unknown> = {};

  if (provider === "facebook") {
    const desiredPageId = getString(existingMetadata?.pageId);
    const page = selectFacebookPage(pages, desiredPageId);
    if (!page) {
      throw new Error(
        desiredPageId
          ? `Could not find Facebook Page ${desiredPageId}. Check that the account still has access to it.`
          : "No Facebook Page with publishing access was returned.",
      );
    }

    const accessToken = getString(page.access_token);
    if (!accessToken) {
      throw new Error("Selected Facebook Page is missing an access token. Try reconnecting and granting publish permissions.");
    }

    if (getString(page.id)) {
      metadata.pageId = page.id;
    }

    if (page.instagram_business_account?.id) {
      metadata.igBusinessId = page.instagram_business_account.id;
    }

    const displayName = getString(page.name);

    return {
      accessToken,
      refreshToken: null,
      expiresAt,
      displayName: displayName ?? null,
      metadata: Object.keys(metadata).length ? metadata : null,
    };
  }

  const desiredIgId = getString(existingMetadata?.igBusinessId);
  const instagramSelection = selectInstagramAccount(pages, desiredIgId);

  if (!instagramSelection) {
    throw new Error(
      desiredIgId
        ? `Could not find Instagram Business Account ${desiredIgId}. Ensure it is linked to the selected Facebook Page.`
        : "No Instagram Business Account was linked to the Facebook Pages returned by Facebook."
    );
  }

  const pageToken = getString(instagramSelection.page.access_token);
  if (!pageToken) {
    throw new Error("Instagram publishing requires a Page access token. Grant the 'pages_manage_posts' permission and reconnect.");
  }

  if (getString(instagramSelection.page.id)) {
    metadata.pageId = instagramSelection.page.id;
  }

  metadata.igBusinessId = instagramSelection.instagram.id;

  if (getString(instagramSelection.instagram.username)) {
    metadata.instagramUsername = instagramSelection.instagram.username;
  }

  const displayName =
    getString(instagramSelection.instagram.username) ??
    getString(instagramSelection.instagram.name) ??
    getString(instagramSelection.page.name);

  return {
    accessToken: pageToken,
    refreshToken: null,
    expiresAt,
    displayName: displayName ?? null,
    metadata,
  };
}

async function exchangeGoogleCode(
  code: string,
  existingMetadata: Record<string, unknown> | null,
  existingDisplayName: string | null,
): Promise<ProviderTokenExchange> {
  const redirectUri = `${SITE_URL}/api/oauth/gbp/callback`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.server.GOOGLE_MY_BUSINESS_CLIENT_ID,
      client_secret: env.server.GOOGLE_MY_BUSINESS_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code,
    }),
  });

  const json = await safeJson(response);
  if (!response.ok) {
    throw new Error(resolveGoogleError(json));
  }

  const accessToken = getString(json?.access_token);
  if (!accessToken) {
    throw new Error("Google token exchange failed: missing access token");
  }

  const refreshToken = getString(json?.refresh_token);
  const expiresIn = normaliseExpires(json?.expires_in);
  const expiresAt = expiresIn ? toIsoExpiry(expiresIn) : null;

  const resolvedLocation = await resolveGoogleLocation(accessToken, existingMetadata, existingDisplayName);

  return {
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt,
    displayName: resolvedLocation?.displayName ?? null,
    metadata: resolvedLocation?.metadata ?? null,
  };
}

async function exchangeLongLivedFacebookToken(shortToken: string) {
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.client.NEXT_PUBLIC_FACEBOOK_APP_ID,
    client_secret: env.server.FACEBOOK_APP_SECRET,
    fb_exchange_token: shortToken,
  });

  const response = await fetch(
    `${GRAPH_BASE}/oauth/access_token?${longParams.toString()}`,
  );
  const json = await safeJson(response);

  if (!response.ok) {
    throw new Error(resolveGraphError(json));
  }

  const accessToken = getString(json?.access_token);
  if (!accessToken) {
    throw new Error("Long-lived token exchange failed");
  }

  return {
    accessToken,
    expiresIn: normaliseExpires(json?.expires_in),
  };
}

async function fetchManagedPages(userAccessToken: string) {
  const params = new URLSearchParams({
    access_token: userAccessToken,
    fields: "id,name,access_token,instagram_business_account{id,username,name}",
  });

  const response = await fetch(
    `${GRAPH_BASE}/me/accounts?${params.toString()}`,
  );
  const json = await safeJson(response);

  if (!response.ok) {
    throw new Error(resolveGraphError(json));
  }

  const data = Array.isArray(json?.data) ? (json.data as FacebookPage[]) : [];
  return data.filter((page) => page && typeof page === "object");
}

function selectFacebookPage(pages: FacebookPage[], desiredPageId: string | null) {
  if (desiredPageId) {
    const matched = pages.find((page) => getString(page.id) === desiredPageId);
    if (matched) {
      return matched;
    }
  }
  return pages[0] ?? null;
}

function selectInstagramAccount(pages: FacebookPage[], desiredInstagramId: string | null) {
  const pagesWithInstagram = pages
    .map((page) => ({
      page,
      instagram: page.instagram_business_account,
    }))
    .filter((entry) => entry.instagram && getString(entry.instagram?.id));

  if (desiredInstagramId) {
    const match = pagesWithInstagram.find(
      (entry) => getString(entry.instagram?.id) === desiredInstagramId,
    );
    if (match) {
      return {
        page: match.page,
        instagram: {
          id: getString(match.instagram?.id)!,
          username: getString(match.instagram?.username) ?? undefined,
          name: getString(match.instagram?.name) ?? undefined,
        },
      };
    }
  }

  const first = pagesWithInstagram[0];
  if (!first) {
    return null;
  }

  return {
    page: first.page,
    instagram: {
      id: getString(first.instagram?.id)!,
      username: getString(first.instagram?.username) ?? undefined,
      name: getString(first.instagram?.name) ?? undefined,
    },
  };
}

async function resolveGoogleLocation(accessToken: string, existingMetadata: Record<string, unknown> | null, existingDisplayName: string | null) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  } as const;

  const desiredLocationId = getString(existingMetadata?.locationId);
  const fallbackDisplayName = existingDisplayName ?? null;

  if (desiredLocationId) {
    const cached = googleLocationCache.get(desiredLocationId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
    const locationResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${desiredLocationId}?readMask=name,title`,
      { headers },
    );
    const locationJson = await safeJson(locationResponse);
    if (locationResponse.ok) {
      const result = {
        metadata: { locationId: desiredLocationId },
        displayName: getString(locationJson?.title) ?? null,
      } as const;
      googleLocationCache.set(desiredLocationId, { ...result, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });
      return result;
    }
    const locationError = resolveGoogleError(locationJson);
    if (locationResponse.status === 429 || /quota/i.test(locationError)) {
      if (desiredLocationId) {
        const fallback = {
          metadata: { locationId: desiredLocationId },
          displayName: fallbackDisplayName,
        } as const;
        googleLocationCache.set(desiredLocationId, { ...fallback, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });
        return fallback;
      }
      throw new Error(locationError || "Google Business Profile quota exceeded. Please retry later.");
    }
    console.warn("[connections] failed to fetch existing GBP location", locationError);
  }

  const accountsResponse = await fetch(
    "https://mybusinessbusinessinformation.googleapis.com/v1/accounts",
    { headers },
  );
  const accountsJson = await safeJson(accountsResponse);

  if (!accountsResponse.ok) {
    const accountsError = resolveGoogleError(accountsJson);
    if (accountsResponse.status === 429 || /quota/i.test(accountsError)) {
      if (desiredLocationId) {
        const fallback = {
          metadata: { locationId: desiredLocationId },
          displayName: fallbackDisplayName,
        } as const;
        googleLocationCache.set(desiredLocationId, { ...fallback, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });
        return fallback;
      }
      throw new Error(accountsError || "Google Business Profile quota exceeded. Please retry later.");
    }
    throw new Error(accountsError);
  }

  const accounts = Array.isArray(accountsJson?.accounts) ? accountsJson.accounts : [];

  for (const account of accounts) {
    const accountName = getString(account?.name);
    if (!accountName) {
      continue;
    }

    const locationsResponse = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?pageSize=100&readMask=name,title`,
      { headers },
    );
    const locationsJson = await safeJson(locationsResponse);

    if (!locationsResponse.ok) {
      const locationsError = resolveGoogleError(locationsJson);
      if (locationsResponse.status === 429 || /quota/i.test(locationsError)) {
        if (desiredLocationId) {
          const fallback = {
            metadata: { locationId: desiredLocationId },
            displayName: fallbackDisplayName,
          } as const;
          googleLocationCache.set(desiredLocationId, { ...fallback, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });
          return fallback;
        }
        throw new Error(locationsError || "Google Business Profile quota exceeded. Please retry later.");
      }
      console.warn(
        "[connections] failed to list GBP locations",
        locationsError,
      );
      continue;
    }

    const locations = Array.isArray(locationsJson?.locations)
      ? (locationsJson.locations as GoogleLocation[])
      : [];

    if (!locations.length) {
      continue;
    }

    const matched = desiredLocationId
      ? locations.find((loc) => getString(loc.name) === desiredLocationId)
      : locations[0];

    const location = matched ?? locations[0];
    if (!location) {
      continue;
    }

    const locationId = getString(location.name);
    if (!locationId) {
      continue;
    }

    const result = {
      metadata: { locationId },
      displayName: getString(location.title) ?? null,
    } as const;
    googleLocationCache.set(locationId, { ...result, expiresAt: Date.now() + GOOGLE_LOCATION_CACHE_TTL_MS });

    return result;
  }

  throw new Error(
    "No Google Business Profile locations were found. Ensure the connected account has at least one verified location.",
  );
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveGraphError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error: { message?: string; type?: string; code?: number } }).error;
    const message = err?.message ?? "Unknown Graph API error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return `${type}${message}${code}`;
  }
  return "Facebook token exchange failed";
}

function resolveGoogleError(payload: unknown) {
  if (payload && typeof payload === "object") {
    if (
      "error_description" in payload &&
      typeof (payload as { error_description: unknown }).error_description === "string"
    ) {
      return (payload as { error_description: string }).error_description;
    }
    if ("error" in payload && typeof (payload as { error: unknown }).error === "string") {
      return (payload as { error: string }).error;
    }
    if ("error" in payload && typeof (payload as { error: unknown }).error === "object") {
      const err = (payload as { error: { message?: unknown; status?: unknown; code?: unknown } }).error;
      if (err && typeof err === "object") {
        const message = typeof err.message === "string" ? err.message : undefined;
        const status = typeof err.status === "string" ? err.status : undefined;
        if (message) {
          return status ? `${status}: ${message}` : message;
        }
      }
    }
  }
  return "Google token exchange failed";
}

function getString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function normaliseExpires(input: unknown): number | null {
  const expiresIn = Number(input ?? 0);
  return Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null;
}

function toIsoExpiry(expiresInSeconds: number) {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}
