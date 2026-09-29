/**
 * What an owner sees when a post fails to publish
 * (tasks/SPEC-plain-publish-failures.md).
 *
 * The publish worker (supabase/functions/publish-queue) stores Meta's own
 * error text in publish_jobs.last_error and in each notification's
 * metadata.error, for example "[instagram_create_container] status=400
 * OAuthException: Only photo or video can be accepted as media type. (code
 * 9004, subcode 2207052) trace=...". That text stays in the database for
 * support. Every owner-facing surface passes it through
 * describePublishFailure() and shows the plain sentence instead: the post
 * page, the post drawer, the failed-post list, the activity feed and the
 * failure emails.
 *
 * Pure and dependency free, so server components, client components and
 * email routes can share it.
 */

export type PublishFailureKind =
  /** A billing hold: its stored wording was written for owners and is kept. */
  | "held"
  /** Our own plain words (a refused post, a tournament review): kept as they are. */
  | "owner_message"
  | "reconnect"
  | "permissions"
  | "account_unlinked"
  | "access_refused"
  | "not_connected"
  | "rate_limit"
  | "daily_limit"
  | "media_fetch"
  | "media_processing"
  | "media_unsupported"
  | "media_missing"
  | "image_load"
  | "story_image"
  | "placement_not_allowed"
  | "story_missed"
  | "content_missing"
  | "banner"
  | "unsupported_platform"
  | "temporary"
  | "unknown";

export interface PublishFailureMessage {
  kind: PublishFailureKind;
  /** Plain British English: what happened and, where useful, what to do next. */
  message: string;
}

export interface PublishFailureInput {
  /** The stored text: publish_jobs.last_error or error_message, or a notification's metadata.error. */
  error: string | null | undefined;
  /** content_items.platform. Anything other than facebook or instagram is a retired platform. */
  platform?: string | null;
  /** content_items.placement: feed or story. */
  placement?: string | null;
  /** publish_jobs.error_code. The Next.js publish path writes a classification (auth, rate_limit, transient). */
  errorCode?: string | null;
}

interface PlatformWords {
  /** "Facebook" */
  name: string;
  /** "Facebook Page" */
  account: string;
  /** What the owner picks again after reconnecting. */
  pick: string;
}

const PLATFORM_WORDS: Record<"facebook" | "instagram", PlatformWords> = {
  facebook: { name: "Facebook", account: "Facebook Page", pick: "your Page" },
  instagram: { name: "Instagram", account: "Instagram account", pick: "your Instagram account" },
};

/** Used only when neither the post nor the stored text says which platform it was. */
const EITHER_PLATFORM: PlatformWords = {
  name: "Facebook or Instagram",
  account: "Facebook Page or Instagram account",
  pick: "your Page or account",
};

/** Every kind whose wording this module writes (held and owner_message keep the stored text). */
type ExplainedKind = Exclude<PublishFailureKind, "held" | "owner_message">;

type MessageBuilder = (words: PlatformWords, isStory: boolean) => string;

const MESSAGES: Record<ExplainedKind, MessageBuilder> = {
  reconnect: (w) =>
    `Cheers can no longer post to ${w.name} because the connection has expired or been cancelled. Reconnect ${w.name} on the Connections page, then try again.`,
  permissions: (w) =>
    `Cheers does not have permission to post to your ${w.account}. Reconnect ${w.name} on the Connections page and allow every permission it asks for.`,
  account_unlinked: (w) =>
    `Cheers can no longer reach your ${w.account}. It may have been unlinked or its access removed. Reconnect ${w.name} on the Connections page and choose ${w.pick} again.`,
  access_refused: (w) =>
    `${w.name} refused access while we were posting this. This is often temporary and we try again automatically. If it keeps happening, reconnect ${w.name} on the Connections page.`,
  not_connected: (w) => `${w.name} is not connected to Cheers. Connect it on the Connections page, then try again.`,
  rate_limit: (w) =>
    `${w.name} is limiting how often we can post for you just now. We try again automatically; if the post has still not gone out, try again later.`,
  daily_limit: (w) =>
    `${w.name} only allows a set number of posts a day, and your account has reached it. Try again later, or move this post to tomorrow.`,
  media_fetch: (w) =>
    `${w.name} could not collect the image from us this time. This is usually a short-lived problem on ${w.name}'s side and we try again automatically. If it keeps failing, try again later.`,
  media_processing: (w) =>
    `${w.name} was still getting the image ready when we tried to post it. We try again automatically; if it keeps failing, try again in a few minutes.`,
  media_unsupported: (w) =>
    `${w.name} could not use the image on this post. It may be the wrong shape, size or file type. Swap in a different image, then try again.`,
  media_missing: (w) => `${w.name} needs an image for this post. Add an image, then try again.`,
  image_load: () =>
    "We could not load the image for this post. Try again in a few minutes; if it keeps failing, swap in a different image.",
  story_image: () =>
    "We could not prepare the image for this story. Choose the image again or swap in a different one, then try again.",
  placement_not_allowed: (w, isStory) =>
    isStory
      ? `${w.name} would not accept this as a story on your account. Try posting it as a feed post instead.`
      : `${w.name} would not accept this type of post on your account. Contact Cheers support if it keeps happening.`,
  story_missed: () =>
    "This story was not posted because its time had passed. Stories only go out close to their scheduled time, so pick a new time for it.",
  content_missing: () =>
    "This post had no caption or image to send. Check the caption and image on the post, then try again.",
  banner: () => "We could not add the banner to the image. Try again, or turn the banner off for this post.",
  unsupported_platform: () => "Cheers no longer posts to this platform, so this post cannot go out.",
  temporary: (w) =>
    `${w.name} had a temporary problem. We try again automatically; if the post has still not gone out, try again in a few minutes.`,
  unknown: (w) =>
    `${w.name} did not accept this post. We will look into it; you can try again or contact Cheers support.`,
};

/** The worker's billing holds all start with this (HOLD_MESSAGES in worker.ts). */
const HOLD_PREFIX = /^On hold:/i;
/** Admin offboarding holds jobs with this text (src/lib/admin/offboarding.ts). */
const OFFBOARDED = /^Brand offboarded\.?$/i;
/** The worker's refusals (unpublishableContentReason) and tournament screening checks. */
const OWNER_WORDING = /^Not published|(?:Review required|Review and regenerate)\.$/i;

/**
 * Texts the worker writes itself, before or instead of a Meta call. Checked
 * first, so a phrase such as "needs attention" is never read as a Meta error.
 */
const WORKER_TEXTS: Array<[RegExp, ExplainedKind]> = [
  [/^Story missed its scheduled window/i, "story_missed"],
  [/^(?:Variant not found|No content variant available|Content copy missing|Content item missing)/i, "content_missing"],
  [/^No connection configured for/i, "not_connected"],
  [/^Unsupported publishing platform/i, "unsupported_platform"],
  [/^BANNER_RENDER_FAILED/i, "banner"],
  [/story derivative/i, "story_image"],
  [/requires? an image attachment/i, "media_missing"],
  [/supports? images only/i, "media_unsupported"],
  [/Unable to fetch media from storage/i, "image_load"],
  [/(?:pageId|igBusinessId) metadata|connection metadata or access token missing/i, "account_unlinked"],
  [/needs attention$|^Access token (?:missing|expired)|^Connection (?:not ready|unavailable)|^Missing (?:Facebook|Instagram) access token/i, "reconnect"],
  [/^Job recovered from stuck|connection probe inconclusive/i, "temporary"],
  [/media container publish did not complete/i, "media_processing"],
];

const RECONNECT_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const MEDIA_FETCH_SUBCODES = new Set([2207003, 2207020, 2207052]);
const MEDIA_UNSUPPORTED_CODES = new Set([324, 36000, 36001, 36003, 36004]);
const MEDIA_UNSUPPORTED_SUBCODES = new Set([1366046, 2207004, 2207005, 2207009, 2207026]);

interface MetaCodes {
  code: number | null;
  subcode: number | null;
  status: number | null;
}

/** Reads "(code 9004, subcode 2207052)", "(#200)", a JSON body's "code": 1 and "status=400". */
function readMetaCodes(text: string): MetaCodes {
  const paren = /\(code (\d+)(?:, subcode (\d+))?\)/i.exec(text);
  const hash = /\(#(\d+)\)/.exec(text);
  const jsonCode = /"code"\s*:\s*(\d+)/.exec(text);
  const jsonSubcode = /"error_subcode"\s*:\s*(\d+)/.exec(text);
  const status = /status=(\d{3})\b/.exec(text);
  const code = paren?.[1] ?? hash?.[1] ?? jsonCode?.[1];
  const subcode = paren?.[2] ?? jsonSubcode?.[1];
  return {
    code: code ? Number(code) : null,
    subcode: subcode ? Number(subcode) : null,
    status: status ? Number(status[1]) : null,
  };
}

/** The kind of a Meta Graph failure, or null when nothing recognisable matched. */
function classifyMetaFailure(text: string, { code, subcode, status }: MetaCodes): ExplainedKind | null {
  if (
    code === 190 ||
    (subcode !== null && RECONNECT_SUBCODES.has(subcode)) ||
    status === 401 ||
    /error validating access token|session (?:has expired|has been invalidated|is invalid)|access token (?:has expired|is invalid)|\btoken (?:has )?expired\b|expired token|has not authori[sz]ed application/i.test(text)
  ) {
    return "reconnect";
  }
  if (subcode === 2207042 || /publishing limit|maximum number of posts/i.test(text)) {
    return "daily_limit";
  }
  if (
    (code !== null && RATE_LIMIT_CODES.has(code)) ||
    (code !== null && code >= 80001 && code <= 80014) ||
    status === 429 ||
    /request limit reached|rate limit|too many calls|calls to this api have exceeded/i.test(text)
  ) {
    return "rate_limit";
  }
  if (
    code === 9004 ||
    (subcode !== null && MEDIA_FETCH_SUBCODES.has(subcode)) ||
    /only photo or video can be accepted|media download has failed|takes too long to download/i.test(text)
  ) {
    return "media_fetch";
  }
  if (code === 9007 || subcode === 2207027 || /media id is not available|media is not ready/i.test(text)) {
    return "media_processing";
  }
  if (
    (code !== null && MEDIA_UNSUPPORTED_CODES.has(code)) ||
    (subcode !== null && MEDIA_UNSUPPORTED_SUBCODES.has(subcode)) ||
    /aspect ratio|image (?:size|dimensions|resolution)|file (?:is )?too (?:large|big)|image format|unsupported (?:image|media|file)|invalid image|image is too (?:small|large)/i.test(text)
  ) {
    return "media_unsupported";
  }
  if (/\bstor(?:y|ies)\b/i.test(text) && /not (?:allowed|supported|available|eligible|enabled)|unavailable|cannot|can't|unable/i.test(text)) {
    return "placement_not_allowed";
  }
  if (
    code === 803 ||
    /unsupported (?:post|get) request|does not exist, cannot be loaded|not an instagram business|instagram account is not linked|no longer linked|not linked to/i.test(text)
  ) {
    return "account_unlinked";
  }
  if (/authori[sz]ation error/i.test(text)) {
    return "access_refused";
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299) || status === 403 || /permission/i.test(text)) {
    return "permissions";
  }
  if (
    code === 1 ||
    code === 2 ||
    (status !== null && status >= 500) ||
    /unknown error|unexpected error|retry your request later|reduce the amount of data|temporarily unavailable|service unavailable/i.test(text)
  ) {
    return "temporary";
  }
  return null;
}

/** The Next.js publish path's ErrorClassification values (src/lib/providers/errors.ts). */
function classifyErrorCode(errorCode: string | null | undefined): ExplainedKind | null {
  switch (errorCode) {
    case "auth":
      return "reconnect";
    case "rate_limit":
      return "rate_limit";
    case "transient":
      return "temporary";
    case "content_rejected":
    case "unknown":
      return "unknown";
    default:
      return null;
  }
}

function normalisePlatform(platform: string | null | undefined): string | null {
  const value = platform?.trim().toLowerCase();
  return value && value !== "unknown" ? value : null;
}

function platformWords(platform: string | null, text: string): PlatformWords {
  if (platform === "facebook" || platform === "instagram") return PLATFORM_WORDS[platform];
  // The worker's phase prefix ("[instagram_create_container]") or its own wording names the platform.
  const named = /\[(facebook|instagram)_/i.exec(text)?.[1] ?? /\b(facebook|instagram)\b/i.exec(text)?.[1];
  return named ? PLATFORM_WORDS[named.toLowerCase() as "facebook" | "instagram"] : EITHER_PLATFORM;
}

/**
 * Plain words for a stored publish failure, or null when there is nothing to
 * explain. Never returns the stored text itself, except a hold or our own
 * refusal wording, which were written for owners in the first place.
 */
export function describePublishFailure(input: PublishFailureInput): PublishFailureMessage | null {
  const text = input.error?.trim() ?? "";
  const codeKind = classifyErrorCode(input.errorCode);
  if (!text && !codeKind) return null;

  if (HOLD_PREFIX.test(text)) return { kind: "held", message: text };
  if (OFFBOARDED.test(text)) return { kind: "held", message: "On hold: this brand has been closed." };
  if (OWNER_WORDING.test(text)) return { kind: "owner_message", message: text };

  const platform = normalisePlatform(input.platform);
  const words = platformWords(platform, text);
  const isStory = input.placement === "story";
  const build = (kind: ExplainedKind): PublishFailureMessage => ({
    kind,
    message: MESSAGES[kind](words, isStory),
  });

  // A retired platform (removed in June 2026, "gbp" in the data); its old failures still sit in history.
  if (platform && platform !== "facebook" && platform !== "instagram") return build("unsupported_platform");

  for (const [pattern, kind] of WORKER_TEXTS) {
    if (pattern.test(text)) return build(kind);
  }

  const metaKind = text ? classifyMetaFailure(text, readMetaCodes(text)) : null;
  return build(metaKind ?? codeKind ?? "unknown");
}

/** The plain sentence alone, for surfaces that show one line of text. */
export function publishFailureText(input: PublishFailureInput): string | null {
  return describePublishFailure(input)?.message ?? null;
}

const CONNECTION_KINDS: ReadonlySet<PublishFailureKind> = new Set<PublishFailureKind>([
  "reconnect",
  "permissions",
  "account_unlinked",
  "access_refused",
  "not_connected",
]);

/**
 * Why the worker marked a connection as needing reconnection. Its
 * connection_needs_action notification keeps Meta's text in metadata.reason.
 * Whatever the reason, the worker flagged the connection, so a reason that is
 * not about the connection itself still reads as "reconnect".
 */
export function connectionFailureText(
  reason: string | null | undefined,
  platform: string | null | undefined,
): string | null {
  const text = reason?.trim() ?? "";
  if (!text) return null;
  const failure = describePublishFailure({ error: text, platform });
  if (failure && CONNECTION_KINDS.has(failure.kind)) return failure.message;
  const known = normalisePlatform(platform);
  return MESSAGES.reconnect(platformWords(known === "facebook" || known === "instagram" ? known : null, text), false);
}
