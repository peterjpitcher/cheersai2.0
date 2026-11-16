/**
 * Lists the Google accounts and business locations a login can manage. Called
 * at connect time only. Server only.
 *
 * - Accounts: GET mybusinessaccountmanagement.googleapis.com/v1/accounts
 *   (20 a page, the maximum).
 * - Locations: GET mybusinessbusinessinformation.googleapis.com/v1/{account}/locations
 *   with the required readMask (100 a page, the maximum).
 * Field names follow Google's reference pages (read 16 November 2026).
 *
 * Fails closed: a refused accounts call, or every locations call refused, is a
 * classified GoogleListError, never an empty list. While the Cloud project has
 * no API approval Google answers 429 (or a quota 403) here; the caller then
 * stores nothing.
 */

import { GOOGLE_HTTP_TIMEOUT_MS } from "@/lib/connections/google-oauth";
import type { GoogleListFailure } from "@/lib/connections/google-messages";

const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const BUSINESS_INFORMATION_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LOCATION_READ_MASK = "name,title,storefrontAddress,metadata";

const ACCOUNT_PAGE_SIZE = 20;
const LOCATION_PAGE_SIZE = 100;
/** 5 pages of 20 accounts and 5 pages of 100 locations each: far more than one owner manages. */
const MAX_ACCOUNT_PAGES = 5;
const MAX_LOCATION_PAGES = 5;

const ACCOUNT_NAME_PATTERN = /^accounts\/[A-Za-z0-9_-]{1,64}$/;
const LOCATION_NAME_PATTERN = /^locations\/[A-Za-z0-9_-]{1,64}$/;

/** ErrorInfo reasons and wording Google uses for "no quota" or "API not switched on". */
const QUOTA_REASONS = new Set([
  "RATE_LIMIT_EXCEEDED",
  "RESOURCE_EXHAUSTED",
  "QUOTA_EXCEEDED",
  "SERVICE_DISABLED",
  "ACCESS_NOT_CONFIGURED",
  "accessNotConfigured",
  "rateLimitExceeded",
  "quotaExceeded",
]);
const QUOTA_WORDING = /quota|rate limit|has not been used in project|is disabled|not been enabled/i;

/** One location as the picker shows it. Safe for the browser: no token. */
export interface GoogleLocationCandidate {
  /** `accounts/{accountId}/locations/{locationId}`: also the local posts parent. */
  id: string;
  title: string;
  /** One line, for telling similar names apart; null when the listing has no address. */
  address: string | null;
  /** The Google account (or location group) the location sits in. */
  accountName: string | null;
  placeId: string | null;
}

export interface GoogleLocationList {
  locations: GoogleLocationCandidate[];
  accountCount: number;
  /** Some accounts or pages could not be listed: the picker says so. */
  incomplete: boolean;
}

export class GoogleListError extends Error {
  constructor(
    public readonly kind: GoogleListFailure,
    public readonly status: number | null,
    /** Google's canonical status (for example RESOURCE_EXHAUSTED); never its message. */
    public readonly googleStatus: string | null,
    public readonly reason: string | null,
    public readonly step: "accounts" | "locations",
  ) {
    super(
      `Google ${step} listing: ${kind} (HTTP ${status ?? "none"}, ${googleStatus ?? "no status"}, ${reason ?? "no reason"})`,
    );
    this.name = "GoogleListError";
  }
}

interface GoogleAccount {
  name: string;
  accountName: string | null;
}

/**
 * Every location the login can manage, across every account, following
 * Google's paging. Throws GoogleListError when nothing could be listed.
 */
export async function listGoogleLocations(accessToken: string): Promise<GoogleLocationList> {
  const accounts = await listAccounts(accessToken);

  const locations: GoogleLocationCandidate[] = [];
  const seen = new Set<string>();
  let incomplete = accounts.truncated;
  let loadedAccounts = 0;
  let firstFailure: GoogleListError | null = null;

  for (const account of accounts.items) {
    try {
      const page = await listAccountLocations(accessToken, account);
      loadedAccounts += 1;
      incomplete = incomplete || page.truncated;
      for (const location of page.items) {
        if (!seen.has(location.id)) {
          seen.add(location.id);
          locations.push(location);
        }
      }
    } catch (error) {
      if (!(error instanceof GoogleListError)) throw error;
      firstFailure ??= error;
      incomplete = true;
    }
  }

  // Nothing loaded, or nothing found while part of the list was refused: that
  // is a failure to list, not "this login has no locations".
  if (firstFailure && (loadedAccounts === 0 || locations.length === 0)) {
    throw firstFailure;
  }

  return { locations, accountCount: accounts.items.length, incomplete };
}

async function listAccounts(accessToken: string): Promise<{ items: GoogleAccount[]; truncated: boolean }> {
  const items: GoogleAccount[] = [];
  let pageToken: string | null = null;

  for (let request = 0; request < MAX_ACCOUNT_PAGES; request += 1) {
    const params = new URLSearchParams({ pageSize: String(ACCOUNT_PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    const json = await getJson(`${ACCOUNTS_URL}?${params.toString()}`, accessToken, "accounts");
    const raw: unknown[] = Array.isArray(json.accounts) ? json.accounts : [];
    for (const entry of raw) {
      const account = toAccount(entry);
      if (account) items.push(account);
    }

    pageToken = readString(json.nextPageToken);
    if (!pageToken) return { items, truncated: false };
  }

  return { items, truncated: true };
}

async function listAccountLocations(
  accessToken: string,
  account: GoogleAccount,
): Promise<{ items: GoogleLocationCandidate[]; truncated: boolean }> {
  const items: GoogleLocationCandidate[] = [];
  let pageToken: string | null = null;

  for (let request = 0; request < MAX_LOCATION_PAGES; request += 1) {
    const params = new URLSearchParams({ readMask: LOCATION_READ_MASK, pageSize: String(LOCATION_PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    const json = await getJson(
      `${BUSINESS_INFORMATION_BASE}/${account.name}/locations?${params.toString()}`,
      accessToken,
      "locations",
    );
    const raw: unknown[] = Array.isArray(json.locations) ? json.locations : [];
    for (const entry of raw) {
      const location = toLocation(entry, account);
      if (location) items.push(location);
    }

    pageToken = readString(json.nextPageToken);
    if (!pageToken) return { items, truncated: false };
  }

  return { items, truncated: true };
}

async function getJson(
  url: string,
  accessToken: string,
  step: "accounts" | "locations",
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(GOOGLE_HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleListError("unavailable", null, null, null, step);
  }

  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    json = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw classifyFailure(response.status, json, step);
  }
  if (!json) {
    throw new GoogleListError("unavailable", response.status, null, "unreadable_body", step);
  }
  return json;
}

/**
 * Google's error body is `{ error: { code, message, status, details[] } }`,
 * where a detail of type ErrorInfo carries a `reason`. The message is read to
 * classify, never kept.
 */
function classifyFailure(
  status: number,
  json: Record<string, unknown> | null,
  step: "accounts" | "locations",
): GoogleListError {
  const error = json?.error && typeof json.error === "object" ? (json.error as Record<string, unknown>) : null;
  const googleStatus = safeCode(error?.status);
  const details: unknown[] = Array.isArray(error?.details) ? (error.details as unknown[]) : [];
  const reason =
    details
      .map((detail) => (detail && typeof detail === "object" ? safeCode((detail as Record<string, unknown>).reason) : null))
      .find((value): value is string => Boolean(value)) ?? null;
  const message = typeof error?.message === "string" ? error.message : "";

  let kind: GoogleListFailure;
  if (status === 429 || googleStatus === "RESOURCE_EXHAUSTED") {
    kind = "not_approved";
  } else if (status === 403) {
    kind = (reason && QUOTA_REASONS.has(reason)) || QUOTA_WORDING.test(message) ? "not_approved" : "permission_denied";
  } else if (status === 401) {
    kind = "permission_denied";
  } else if (status >= 500) {
    kind = "unavailable";
  } else {
    kind = "failed";
  }

  return new GoogleListError(kind, status, googleStatus, reason, step);
}

function toAccount(raw: unknown): GoogleAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const name = readString(entry.name);
  if (!name || !ACCOUNT_NAME_PATTERN.test(name)) return null;
  return { name, accountName: readString(entry.accountName) };
}

/**
 * The Business Information API names a location `locations/{id}` with no
 * account, so the account it was listed under is joined on to make the one
 * stored format, `accounts/{accountId}/locations/{locationId}`.
 */
function toLocation(raw: unknown, account: GoogleAccount): GoogleLocationCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const name = readString(entry.name);
  if (!name || !LOCATION_NAME_PATTERN.test(name)) return null;

  const metadata = entry.metadata && typeof entry.metadata === "object" ? (entry.metadata as Record<string, unknown>) : null;

  return {
    id: `${account.name}/${name}`,
    title: readString(entry.title) ?? "Unnamed location",
    address: formatAddress(entry.storefrontAddress),
    accountName: account.accountName,
    placeId: readString(metadata?.placeId),
  };
}

/** Street lines, town and postcode on one line. */
function formatAddress(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const address = raw as Record<string, unknown>;
  const lines: unknown[] = Array.isArray(address.addressLines) ? address.addressLines : [];
  const parts = [...lines, address.locality, address.postalCode]
    .map((part) => readString(part))
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** A short status or reason code; anything that does not look like one is dropped. */
function safeCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z_]{1,60}$/.test(value) ? value : null;
}
