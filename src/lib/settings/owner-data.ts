import { CONTACT } from '@/lib/legal/company';

/**
 * The owner's "Download my data" and "Ask us to close this venue" in Settings
 * (tasks/SPEC-self-serve-signup.md, section 5, "Later (P10)"). They replace the
 * P10 line that asked owners to email us, and like it they show only to
 * owners and only while self-serve sign-up is on.
 *
 * Client-safe: plain values only, shared by the Settings section, the export
 * route, the closure action and the emails, so they all say the same thing.
 */

/** Downloads per brand per rolling day (owner_data_export in src/lib/auth/rate-limit.ts). */
export const OWNER_EXPORTS_PER_DAY = 3;

/** A second closure request for a venue within this many hours sends no email. */
export const CLOSURE_REPEAT_WINDOW_HOURS = 24;

/**
 * Days a closed venue's data is kept before it is deleted: PURGE_AFTER_DAYS in
 * src/lib/admin/offboarding.ts (decision D5). A test keeps the two equal; this
 * copy exists so the browser bundle does not pull in the offboarding code.
 */
export const CLOSED_VENUE_KEPT_DAYS = 30;

/** The route the Settings section posts to for the download. */
export const OWNER_EXPORT_PATH = '/api/settings/data-export';

/**
 * A header the Settings section sends with the download request. A page on
 * another site cannot add it without a CORS preflight, which this route never
 * answers, so a cross-site form or script cannot start an export.
 */
export const OWNER_EXPORT_HEADER = 'x-cheers-owner-export';

/**
 * What happens after an owner asks us to close their venue, in plain words.
 * It follows docs/runbooks/customer-offboarding.md ("When a customer asks to
 * leave" and "After 30 days"); change both together.
 */
export const CLOSURE_STEPS: readonly string[] = [
  `We email you from ${CONTACT.email} to check that the request came from you.`,
  'We cancel your Cheers subscription, straight away or at the end of the period you have paid for, as we agree with you. If you run paid Meta ads through Cheers, we pause them.',
  'If you want a copy of your data, download it before we close the venue. We can also send you one.',
  'We close the venue: scheduled posts go back to drafts and are not published, we delete the Facebook, Instagram and other connection keys we hold, and your team can no longer see the venue.',
  `We keep the venue's data for ${CLOSED_VENUE_KEPT_DAYS} days after closing it, then permanently delete its posts, photos and videos, settings and link-in-bio page, and any Cheers login used only for this venue.`,
  'Posts already published stay on your Facebook Page and Instagram account. You can delete them there.',
];

export const OWNER_DATA_MESSAGES = {
  notAvailable: `This is not available yet. To close this venue or get a copy of your data, email ${CONTACT.email}.`,
  ownersOnly: `Only an owner of this venue can do this. Ask an owner, or email ${CONTACT.email}.`,
  brandSwitched: 'You switched venue in another tab. Refresh the page and try again.',
  signedOut: 'You are not signed in any more. Refresh the page, sign in and try again.',
  exportFailed: `We could not prepare your download. Please try again in a few minutes, or email ${CONTACT.email} and we will send you a copy.`,
  exportLimited: (retryAfterSeconds: number): string => {
    const hours = Math.max(1, Math.ceil(retryAfterSeconds / 3600));
    return `You can download your data ${OWNER_EXPORTS_PER_DAY} times a day. Please try again in ${hours} ${
      hours === 1 ? 'hour' : 'hours'
    }, or email ${CONTACT.email}.`;
  },
  closureFailed: `We could not send your request. Please try again in a few minutes, or email ${CONTACT.email} to ask us to close this venue.`,
} as const;
