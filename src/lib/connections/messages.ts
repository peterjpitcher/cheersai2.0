/**
 * What an owner sees when connecting Facebook or Instagram fails. Plain words
 * only (tasks/SPEC-plain-error-messages.md): the technical detail goes to the
 * log. Constants only, so the OAuth callback, the server actions and the
 * Connections page can all share them.
 */
export const CONNECT_MESSAGES = {
  /** An unknown, used or expired state, or one someone else started. */
  expiredLink: "This connection link has expired or was already used. Please click Connect again.",
  startFailed: "We could not start the connection. Please try again.",
  finishFailed: "We could not finish connecting. Please click Connect again.",
  /** Meta refused the code exchange or the Page list. */
  metaLoginFailed: "Facebook did not finish the sign-in. Please click Connect again.",
  /** The owner cancelled on Facebook, or Facebook sent no code. */
  cancelled: "The Facebook sign-in was cancelled or did not finish. Please click Connect again.",
} as const;

/**
 * The Meta Ads callback (/api/oauth/facebook-ads/callback) sends the page an
 * `ads_error` code, never Meta's own text. Any code not listed here (Meta's
 * `error` value, such as access_denied, is passed through) reads as cancelled.
 */
const ADS_CONNECT_MESSAGES: Record<string, string> = {
  missing_state: "This connection link has expired or was already used. Please click Connect Meta Ads again.",
  invalid_state: "This connection link has expired or was already used. Please click Connect Meta Ads again.",
  state_already_used: "This connection link has expired or was already used. Please click Connect Meta Ads again.",
  missing_account: "We could not tell which brand started this connection. Please click Connect Meta Ads again.",
  not_available: "Paid ads are not switched on for this brand.",
  token_exchange_failed: "Facebook did not finish the sign-in. Please click Connect Meta Ads again.",
  token_missing: "Facebook did not finish the sign-in. Please click Connect Meta Ads again.",
  db_error: "We could not save your Meta Ads connection. Please click Connect Meta Ads again.",
  unexpected_error: "We could not save your Meta Ads connection. Please click Connect Meta Ads again.",
};

const ADS_CONNECT_CANCELLED =
  "The Facebook sign-in was cancelled or did not finish. Please click Connect Meta Ads again.";

/** Plain words for an `ads_error` code on the Connections page. */
export function adsConnectErrorMessage(code: string): string {
  return Object.hasOwn(ADS_CONNECT_MESSAGES, code) ? ADS_CONNECT_MESSAGES[code] : ADS_CONNECT_CANCELLED;
}

/**
 * Saving or clearing a connection. Shown after the OAuth callback and by the
 * Page chooser, so "try connecting again" fits both.
 */
export const CONNECTION_SAVE_MESSAGES = {
  saveFailed: "We could not save this connection. Please try connecting again.",
  secureStoreFailed:
    "We could not save this connection securely. Please try connecting again, and contact Cheers support if it keeps happening.",
  activateFailed: "We could not finish this connection. Please try connecting again.",
  disconnectFailed: "We could not disconnect this account. Please try again.",
} as const;
