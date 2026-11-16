/**
 * Google connection: constants and what an owner sees when it fails
 * (tasks/SPEC-gbp-posting-reintroduction.md, section 4). Plain words only; the
 * technical detail goes to the log. Pure and browser-safe: no env, no database.
 *
 * Google is a connection-side provider only. It is deliberately NOT part of
 * the content `Platform` type, so create, the planner, AI copy and the rest
 * keep working with Facebook and Instagram alone until their own pieces ship.
 */

/** The provider key in social_connections, oauth_states and the callback URL. */
export const GOOGLE_PROVIDER = "gbp" as const;
export type GoogleProvider = typeof GOOGLE_PROVIDER;

/** The one OAuth scope requested: manage the login's business listings. */
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";

/** Where the owner picks a location. Also the marker on a pending choice row. */
export const GOOGLE_LOCATION_CHOICE_PATH = "/connections/choose-location";

export const GOOGLE_CONNECT_MESSAGES = {
  /** The brand's googlePosts switch is off (decision D10). */
  notAvailable: "Google posting is not switched on for this brand.",
  /** The OAuth client id or secret is missing from the environment. */
  notSetUp: "Google posting is not set up.",
  cancelled: "The Google sign-in was cancelled or did not finish. Nothing was saved. Please click Connect again.",
  /** Google refused the code exchange. */
  loginFailed: "Google did not finish the sign-in. Nothing was saved. Please click Connect again.",
  /** No refresh token came back, so posting would stop within the hour. */
  noRefreshToken:
    "Google did not give CheersAI ongoing access, so nothing was saved. Please click Connect again and allow access when Google asks.",
  /** HTTP 429, or a 403 about quota or a switched-off API: the Cloud project is not approved. */
  notApproved:
    "Google has not approved API access for this app yet, so your profile could not be listed. Nothing was saved.",
  permissionDenied:
    "Google did not give CheersAI permission to see your business profiles. Nothing was saved. Please click Connect again and allow access when Google asks.",
  unavailable:
    "Google is not responding at the moment, so your profile could not be listed. Nothing was saved. Please try again in a few minutes.",
  listFailed:
    "We could not list your Google profiles. Nothing was saved. Please try again, and contact Cheers support if it keeps happening.",
  noAccounts:
    "This Google login does not manage any business profiles. Nothing was saved. Sign in with the Google account that owns or manages your profile.",
  noLocations:
    "This Google login has no business locations CheersAI could list. Nothing was saved. Sign in with the Google account that owns or manages your profile.",
  choiceSaveFailed: "We could not save your list of locations. Nothing was saved. Please click Connect again.",
} as const;

/** Why listing accounts and locations failed. */
export type GoogleListFailure = "not_approved" | "permission_denied" | "unavailable" | "failed";

export const GOOGLE_LIST_FAILURE_MESSAGES: Record<GoogleListFailure, string> = {
  not_approved: GOOGLE_CONNECT_MESSAGES.notApproved,
  permission_denied: GOOGLE_CONNECT_MESSAGES.permissionDenied,
  unavailable: GOOGLE_CONNECT_MESSAGES.unavailable,
  failed: GOOGLE_CONNECT_MESSAGES.listFailed,
};

/** `accounts/{accountId}/locations/{locationId}`: the one stored format for a location. */
export const GOOGLE_LOCATION_ID_PATTERN = /^accounts\/[A-Za-z0-9_-]{1,64}\/locations\/[A-Za-z0-9_-]{1,64}$/;
