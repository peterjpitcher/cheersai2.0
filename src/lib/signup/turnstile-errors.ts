/**
 * Which Turnstile widget failures mean our set-up is broken, and so are worth
 * an operator alert (review of PR #144). Shared by the sign-up form and the
 * server action that receives its reports, so both apply the same rule. Safe
 * to import anywhere (no server imports).
 *
 * Cloudflare's client-side error codes
 * (developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes,
 * read 28 September 2026). Only the site key, domain and configuration codes
 * are ours to fix:
 *   110100 invalid sitekey          110110 sitekey not found
 *   110200 domain not authorised    400020 invalid sitekey
 *   400021 sitekey domain mismatch  400070 sitekey disabled
 * Not reported, because they are the visitor's browser, clock, network or
 * behaviour: 110600 and 110620 (timeouts), 200100 (clock or cache), 200500
 * (iframe blocked, usually an extension), 300xxx and 600xxx (challenge
 * failures, bot-like behaviour).
 */

export type TurnstileWidgetFailure = 'script_load_failed' | 'script_timeout' | 'render_failed' | 'widget_error';

export const TURNSTILE_CONFIG_ERROR_CODES: readonly string[] = ['110100', '110110', '110200', '400020', '400021', '400070'];

/**
 * True when the failure points at our set-up: Cloudflare's script could not
 * load or never showed the widget, the widget refused our parameters, or
 * Cloudflare reported a site key, domain or configuration error code.
 */
export function isTurnstileSetupFailure(reason: TurnstileWidgetFailure, code?: string): boolean {
  if (reason === 'widget_error') return code !== undefined && TURNSTILE_CONFIG_ERROR_CODES.includes(code);
  return true;
}
