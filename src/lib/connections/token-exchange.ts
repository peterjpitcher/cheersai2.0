import { env } from "@/env";
import { getMetaGraphApiBase } from "@/lib/meta/graph";
import { redactMetaAccessTokens } from "@/lib/meta/redact";
import type { Provider } from "@/lib/connections/oauth";
import { toManagedPage, type ManagedPage } from "@/lib/connections/page-selection";

const SITE_URL = env.client.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
const GRAPH_BASE = getMetaGraphApiBase();
const GRAPH_HOST = "graph.facebook.com";

/**
 * `/me/accounts` returns 25 Pages a request. Four requests cover 100 Pages,
 * far more than a venue owner manages, and bound the callback's time.
 */
const MAX_PAGE_LIST_REQUESTS = 4;

export interface ProviderTokenExchange {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  displayName?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * App-scoped Meta user id of the person who connected. Meta sends it to the
   * data-deletion and deauthorise callbacks; storing it is what lets those
   * callbacks find this connection. Null when the lookup failed.
   */
  metaUserId?: string | null;
}

/** What the login itself yields, before a Page is chosen. Server only. */
export interface MetaUserAuth {
  /** Long-lived Meta user token (the short-lived one if the upgrade failed). Never log it. */
  userAccessToken: string;
  /** When the user token expires; stored as the connection's token_expires_at, as before. */
  expiresAt: string | null;
  metaUserId: string | null;
}

/**
 * Swaps the OAuth code for a Meta user token (long-lived when Meta allows it)
 * and reads the Meta user id. Page selection happens separately.
 */
export async function exchangeCodeForUserToken(provider: Provider, code: string): Promise<MetaUserAuth> {
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

  return {
    userAccessToken,
    expiresAt: expiresIn ? toIsoExpiry(expiresIn) : null,
    metaUserId: await fetchMetaUserId(userAccessToken),
  };
}

/**
 * The connection to store for a chosen Page: the Page token plus the ids
 * publishing reads (Facebook: pageId; Instagram: igBusinessId and pageId).
 * Throws with an owner-readable message when the Page cannot be used.
 */
export function buildPageConnection(
  provider: Provider,
  page: ManagedPage,
  auth: Pick<MetaUserAuth, "expiresAt" | "metaUserId">,
): ProviderTokenExchange {
  if (provider === "facebook") {
    if (!page.accessToken) {
      throw new Error("Selected Facebook Page is missing an access token. Try reconnecting and granting publish permissions.");
    }

    const metadata: Record<string, unknown> = { pageId: page.id };
    if (page.instagram) {
      metadata.igBusinessId = page.instagram.id;
    }

    return {
      accessToken: page.accessToken,
      refreshToken: null,
      expiresAt: auth.expiresAt,
      displayName: page.name,
      metadata,
      metaUserId: auth.metaUserId,
    };
  }

  const instagram = page.instagram;
  if (!instagram) {
    throw new Error("No Instagram Business Account is linked to the selected Facebook Page.");
  }
  if (!page.accessToken) {
    throw new Error("Instagram publishing requires a Page access token. Grant the 'pages_manage_posts' permission and reconnect.");
  }

  const metadata: Record<string, unknown> = { pageId: page.id, igBusinessId: instagram.id };
  if (instagram.username) {
    metadata.instagramUsername = instagram.username;
  }

  return {
    accessToken: page.accessToken,
    refreshToken: null,
    expiresAt: auth.expiresAt,
    displayName: instagram.username ?? instagram.name ?? page.name,
    metadata,
    metaUserId: auth.metaUserId,
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

/**
 * The app-scoped id of the person who connected. Never fails the connection:
 * a missing id only means a later Meta deletion request cannot be matched
 * automatically (it is then handled by hand from the request log).
 */
export async function fetchMetaUserId(userAccessToken: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ access_token: userAccessToken, fields: "id" });
    const response = await fetch(`${GRAPH_BASE}/me?${params.toString()}`);
    const json = await safeJson(response);
    return response.ok ? getString((json as { id?: unknown } | null)?.id) : null;
  } catch (error) {
    console.warn("[connections] could not read the Meta user id", error);
    return null;
  }
}

/**
 * Every Page the person manages, with its token, their tasks on it and any
 * linked Instagram professional account. Follows Meta's paging (Graph host
 * only) up to MAX_PAGE_LIST_REQUESTS requests.
 */
export async function fetchManagedPages(userAccessToken: string): Promise<ManagedPage[]> {
  const params = new URLSearchParams({
    access_token: userAccessToken,
    fields: "id,name,access_token,tasks,instagram_business_account{id,username,name}",
  });

  const pages: ManagedPage[] = [];
  const seen = new Set<string>();
  let url: string | null = `${GRAPH_BASE}/me/accounts?${params.toString()}`;

  for (let request = 0; url && request < MAX_PAGE_LIST_REQUESTS; request += 1) {
    const response = await fetch(url);
    const json = await safeJson(response);

    if (!response.ok) {
      throw new Error(resolveGraphError(json));
    }

    const data: unknown[] = Array.isArray(json?.data) ? json.data : [];
    for (const raw of data) {
      const page = toManagedPage(raw);
      if (page && !seen.has(page.id)) {
        seen.add(page.id);
        pages.push(page);
      }
    }

    url = nextGraphPageUrl(json);
  }

  return pages;
}

/** Meta's `paging.next`, only when it points back at the Graph API over https. */
function nextGraphPageUrl(payload: unknown): string | null {
  const next = (payload as { paging?: { next?: unknown } } | null)?.paging?.next;
  if (typeof next !== "string") {
    return null;
  }
  try {
    const parsed = new URL(next);
    return parsed.protocol === "https:" && parsed.hostname === GRAPH_HOST ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Meta's error as text, with any access token it echoes removed (it is logged and shown). */
function resolveGraphError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error: { message?: string; type?: string; code?: number } }).error;
    const message = err?.message ?? "Unknown Graph API error";
    const type = err?.type ? `${err.type}: ` : "";
    const code = err?.code ? ` (code ${err.code})` : "";
    return redactMetaAccessTokens(`${type}${message}${code}`);
  }
  return "Facebook token exchange failed";
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
