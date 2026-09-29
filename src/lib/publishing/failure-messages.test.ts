import { describe, expect, it } from "vitest";

import {
  connectionFailureText,
  describePublishFailure,
  publishFailureText,
  type PublishFailureKind,
} from "./failure-messages";

type Sample = {
  /** Where the sample came from. */
  note: string;
  error: string;
  platform: string | null;
  placement?: string;
  errorCode?: string;
  kind: PublishFailureKind;
  /** Words the owner must see. */
  says: string[];
};

// Samples marked "live" are stored texts read from production
// (publish_jobs.last_error and notifications.metadata, 29 September 2026),
// with trace ids and object ids replaced. The rest are the Meta codes the
// publish worker and src/lib/providers already handle.
const SAMPLES: Sample[] = [
  // Expired or revoked token
  {
    note: "error 190 with session subcode",
    error:
      "[facebook_feed_publish] status=400 OAuthException: Error validating access token: Session has expired on Saturday, 27-Sep-26 09:00:00 PDT. (code 190, subcode 463) trace=AbC123",
    platform: "facebook",
    kind: "reconnect",
    says: ["Reconnect Facebook on the Connections page", "expired or been cancelled"],
  },
  {
    note: "error 190 after a password change",
    error:
      "[instagram_create_container] status=400 OAuthException: Error validating access token: The session has been invalidated because the user changed their password. (code 190, subcode 460) trace=AbC123",
    platform: "instagram",
    kind: "reconnect",
    says: ["Reconnect Instagram on the Connections page"],
  },
  { note: "live: connection flagged earlier", error: "theanchor.pub needs attention", platform: "instagram", kind: "reconnect", says: ["Reconnect Instagram"] },
  { note: "worker: token expired before the call", error: "Access token expired", platform: "facebook", kind: "reconnect", says: ["Reconnect Facebook"] },
  { note: "worker: no token stored", error: "Missing Instagram access token", platform: "instagram", kind: "reconnect", says: ["Reconnect Instagram"] },
  { note: "Next.js path auth classification", error: "Token expired", platform: "facebook", errorCode: "auth", kind: "reconnect", says: ["Reconnect Facebook"] },
  { note: "Next.js path auth with no text", error: "", platform: "instagram", errorCode: "auth", kind: "reconnect", says: ["Reconnect Instagram"] },

  // Permissions missing
  {
    note: "error 10",
    error: "[facebook_feed_publish] status=403 OAuthException: (#10) Application does not have permission for this action (code 10) trace=AbC123",
    platform: "facebook",
    kind: "permissions",
    says: ["does not have permission to post to your Facebook Page", "allow every permission"],
  },
  {
    note: "error 200",
    error: "[facebook_photo_publish] status=403 OAuthException: (#200) Requires pages_manage_posts permission to manage the object (code 200) trace=AbC123",
    platform: "facebook",
    kind: "permissions",
    says: ["Reconnect Facebook on the Connections page and allow every permission it asks for."],
  },
  {
    note: "error 200 range on Instagram",
    error: "[instagram_publish_container] status=400 OAuthException: (#230) Requires instagram_content_publish permission (code 230) trace=AbC123",
    platform: "instagram",
    kind: "permissions",
    says: ["your Instagram account"],
  },

  // Rate limits
  { note: "error 4", error: "[facebook_feed_publish] status=400 OAuthException: (#4) Application request limit reached (code 4) trace=AbC123", platform: "facebook", kind: "rate_limit", says: ["Facebook is limiting how often", "try again later"] },
  { note: "error 17", error: "[instagram_create_container] status=400 OAuthException: (#17) User request limit reached (code 17, subcode 2446079) trace=AbC123", platform: "instagram", kind: "rate_limit", says: ["Instagram is limiting"] },
  { note: "error 32", error: "[facebook_photo_publish] status=400 OAuthException: (#32) Page request limit reached (code 32) trace=AbC123", platform: "facebook", kind: "rate_limit", says: ["Facebook is limiting"] },
  { note: "error 613", error: "[facebook_feed_publish] status=400 OAuthException: (#613) Calls to this api have exceeded the rate limit. (code 613) trace=AbC123", platform: "facebook", kind: "rate_limit", says: ["We try again automatically"] },
  { note: "Next.js path rate limit classification", error: "Meta Graph API error: 429", platform: "instagram", errorCode: "rate_limit", kind: "rate_limit", says: ["Instagram is limiting"] },

  // Instagram's daily publishing limit
  {
    note: "Instagram daily limit",
    error: "[instagram_create_container] status=400 OAuthException: Application request limit reached (code 9, subcode 2207042) trace=AbC123",
    platform: "instagram",
    kind: "daily_limit",
    says: ["Instagram only allows a set number of posts a day", "move this post to tomorrow"],
  },

  // Instagram media fetch (transient, retried; PR #45)
  {
    note: "live: 9004 / 2207052 on a story",
    error: "[instagram_create_container] status=400 OAuthException: Only photo or video can be accepted as media type. (code 9004, subcode 2207052) trace=AbC123",
    platform: "instagram",
    placement: "story",
    kind: "media_fetch",
    says: ["Instagram could not collect the image from us", "short-lived problem on Instagram's side"],
  },
  {
    note: "live: 9007 media not ready",
    error: "OAuthException: Media ID is not available (code 9007)",
    platform: "instagram",
    kind: "media_processing",
    says: ["Instagram was still getting the image ready"],
  },
  { note: "worker: container never finished", error: "Instagram media container publish did not complete", platform: "instagram", kind: "media_processing", says: ["try again in a few minutes"] },

  // Unsupported image size or shape
  {
    note: "Instagram 36003 aspect ratio",
    error: "[instagram_create_container] status=400 OAuthException: The aspect ratio is not supported. (code 36003, subcode 2207009) trace=AbC123",
    platform: "instagram",
    kind: "media_unsupported",
    says: ["Instagram could not use the image on this post", "Swap in a different image"],
  },
  {
    note: "Instagram image too large",
    error: "[instagram_create_container] status=400 OAuthException: The image size is too large. (code 36001, subcode 2207004) trace=AbC123",
    platform: "instagram",
    kind: "media_unsupported",
    says: ["wrong shape, size or file type"],
  },
  { note: "Facebook invalid image file", error: "[facebook_photo_publish] status=400 OAuthException: (#324) Missing or invalid image file (code 324) trace=AbC123", platform: "facebook", kind: "media_unsupported", says: ["Facebook could not use the image"] },
  { note: "worker: video on Instagram", error: "Instagram publishing currently supports images only", platform: "instagram", kind: "media_unsupported", says: ["Instagram could not use the image"] },
  { note: "worker: no image", error: "Instagram requires an image attachment for publishing", platform: "instagram", kind: "media_missing", says: ["Instagram needs an image for this post"] },
  { note: "worker: story with no image", error: "Facebook stories require an image attachment", platform: "facebook", placement: "story", kind: "media_missing", says: ["Facebook needs an image"] },
  { note: "live: story image not prepared", error: "Story derivative not available for selected media", platform: "facebook", placement: "story", kind: "story_image", says: ["We could not prepare the image for this story"] },
  { note: "worker: our storage refused the image", error: "[facebook_story_fetch] status=404 message=Unable to fetch media from storage", platform: "facebook", placement: "story", kind: "image_load", says: ["We could not load the image"] },

  // Story or placement not allowed
  {
    note: "stories not available for this Page",
    error: "[facebook_story] status=400 OAuthException: Stories are not available for this Page (code 100) trace=AbC123",
    platform: "facebook",
    placement: "story",
    kind: "placement_not_allowed",
    says: ["Facebook would not accept this as a story on your account", "feed post instead"],
  },
  { note: "live: story missed its window", error: "Story missed its scheduled window", platform: "instagram", placement: "story", kind: "story_missed", says: ["pick a new time for it"] },

  // The Page or Instagram account no longer linked
  {
    note: "live: Page object gone or not accessible",
    error:
      "GraphMethodException: Unsupported post request. Object with ID '100000000000000' does not exist, cannot be loaded due to missing permissions, or does not support this operation. Please read the Graph API documentation at https://developers.facebook.com/docs/graph-api (code 100, subcode 33)",
    platform: "facebook",
    placement: "story",
    kind: "account_unlinked",
    says: ["Cheers can no longer reach your Facebook Page", "choose your Page again"],
  },
  { note: "not an Instagram business account", error: "[instagram_create_container] status=400 OAuthException: The user is not an Instagram Business (code 100) trace=AbC123", platform: "instagram", kind: "account_unlinked", says: ["your Instagram account"] },
  { note: "worker: no Page chosen", error: "Facebook connection missing pageId metadata.", platform: "facebook", kind: "account_unlinked", says: ["choose your Page again"] },
  { note: "worker: not connected", error: "No connection configured for instagram", platform: "instagram", kind: "not_connected", says: ["Instagram is not connected to Cheers"] },

  // Ambiguous Meta authorisation error (the worker probes and usually retries)
  {
    note: "live: 100 / 33 authorisation error on container status",
    error: "[instagram_container_status] status=400 GraphMethodException: Authorization Error (code 100, subcode 33) trace=AbC123",
    platform: "instagram",
    kind: "access_refused",
    says: ["Instagram refused access", "often temporary"],
  },

  // Temporary Meta problems
  { note: "live: unknown error code 1", error: "[facebook_photo_publish] status=500 An unknown error occurred (code 1, subcode 99)", platform: "facebook", kind: "temporary", says: ["Facebook had a temporary problem"] },
  { note: "live: reduce the amount of data", error: "[facebook_photo_publish] status=500 Please reduce the amount of data you're asking for, then retry your request (code 1)", platform: "facebook", kind: "temporary", says: ["temporary problem"] },
  { note: "live: code 2 on Instagram", error: "[instagram_create_container] status=500 OAuthException: An unexpected error has occurred. Please retry your request later. (code 2) trace=AbC123", platform: "instagram", kind: "temporary", says: ["Instagram had a temporary problem"] },
  {
    note: "live: old story format with a JSON body",
    error:
      '[facebook_story] status=500 message=OAuthException: An unknown error has occurred. (code 1) body={"error":{"message":"An unknown error has occurred.","type":"OAuthException","code":1,"fbtrace_id":"AbC123"}}',
    platform: "facebook",
    placement: "story",
    kind: "temporary",
    says: ["Facebook had a temporary problem"],
  },
  { note: "worker: recovered a stuck job", error: "Job recovered from stuck in_progress state", platform: "facebook", kind: "temporary", says: ["We try again automatically"] },

  // Our own failures before any Meta call
  { note: "live: no content variant", error: "No content variant available", platform: "facebook", kind: "content_missing", says: ["no caption or image to send"] },
  { note: "worker: empty caption", error: "Content copy missing", platform: "instagram", kind: "content_missing", says: ["Check the caption and image"] },
  { note: "worker: banner render", error: "BANNER_RENDER_FAILED: satori threw", platform: "facebook", kind: "banner", says: ["We could not add the banner"] },
  { note: "live: retired platform", error: "No connection configured for gbp", platform: "gbp", kind: "unsupported_platform", says: ["no longer posts to this platform"] },

  // Anything unknown
  {
    note: "live: unrecognised text",
    error: "safeJson is not defined",
    platform: "facebook",
    kind: "unknown",
    says: ["Facebook did not accept this post. We will look into it; you can try again or contact Cheers support."],
  },
  {
    note: "worker: odd Meta response",
    error: "Instagram publish response missing id",
    platform: "instagram",
    kind: "unknown",
    says: ["Instagram did not accept this post. We will look into it; you can try again or contact Cheers support."],
  },
  { note: "Next.js path content rejected", error: "Meta Graph API error: 400", platform: "facebook", errorCode: "content_rejected", kind: "unknown", says: ["Facebook did not accept this post"] },
];

/** Fragments of Meta's or our own technical text that an owner must never see. */
const TECHNICAL = [
  /\(code \d+/i,
  /subcode/i,
  /Exception/,
  /trace=/,
  /status=/,
  /\[[a-z_]+\]/,
  /Graph API/i,
  /[{}]/,
  /\bid\b/i,
  /undefined|null|NaN/,
];

const EM_DASH = String.fromCharCode(0x2014);

describe("describePublishFailure", () => {
  it.each(SAMPLES)("$note -> $kind", (sample) => {
    const result = describePublishFailure({
      error: sample.error,
      platform: sample.platform,
      placement: sample.placement ?? null,
      errorCode: sample.errorCode ?? null,
    });

    expect(result?.kind).toBe(sample.kind);
    for (const words of sample.says) {
      expect(result?.message).toContain(words);
    }
    for (const pattern of TECHNICAL) {
      expect(result?.message).not.toMatch(pattern);
    }
    // No em dashes in anything an owner reads.
    expect(result?.message).not.toContain(EM_DASH);
    if (sample.error.length > 20) {
      expect(result?.message).not.toContain(sample.error);
    }
  });

  it("names the platform of the post, not the other one", () => {
    const facebook = publishFailureText({ error: "safeJson is not defined", platform: "facebook" });
    const instagram = publishFailureText({ error: "safeJson is not defined", platform: "instagram" });

    expect(facebook).toMatch(/^Facebook /);
    expect(facebook).not.toContain("Instagram");
    expect(instagram).toMatch(/^Instagram /);
    expect(instagram).not.toContain("Facebook");
  });

  it("reads the platform from the stored text when the post's platform is unknown", () => {
    expect(
      publishFailureText({
        error: "[instagram_create_container] status=500 OAuthException: An unknown error has occurred. (code 1) trace=AbC123",
        platform: "unknown",
      }),
    ).toMatch(/^Instagram had a temporary problem/);
    expect(publishFailureText({ error: "safeJson is not defined", platform: null })).toMatch(
      /^Facebook or Instagram did not accept this post/,
    );
  });

  it("keeps the wording of a billing hold as it is", () => {
    const hold =
      "On hold: this brand's subscription has lapsed. Future posts go out once an owner restarts it from Billing; past-due posts will need rescheduling.";

    expect(describePublishFailure({ error: hold, platform: "facebook" })).toEqual({ kind: "held", message: hold });
    expect(describePublishFailure({ error: "Brand offboarded.", platform: "facebook" })).toEqual({
      kind: "held",
      message: "On hold: this brand has been closed.",
    });
  });

  it.each([
    "Not published: this post is still a draft. Approve it in the planner to schedule it.",
    "Screening changed. Review and regenerate.",
    "Opening and kitchen times unavailable. Review required.",
  ])("keeps our own plain wording: %s", (text) => {
    expect(describePublishFailure({ error: text, platform: "instagram" })).toEqual({ kind: "owner_message", message: text });
  });

  it("returns null when there is nothing to explain", () => {
    expect(describePublishFailure({ error: null, platform: "facebook" })).toBeNull();
    expect(describePublishFailure({ error: "   ", platform: "facebook" })).toBeNull();
    expect(describePublishFailure({ error: undefined, platform: "facebook", errorCode: "CONTENT_NOT_PUBLISHABLE" })).toBeNull();
    expect(publishFailureText({ error: null, platform: "instagram" })).toBeNull();
  });

  it("uses a classification from the Next.js path when the text says nothing useful", () => {
    expect(describePublishFailure({ error: "Request failed", platform: "facebook", errorCode: "transient" })?.kind).toBe("temporary");
    expect(describePublishFailure({ error: "Request failed", platform: "facebook", errorCode: "unknown" })?.kind).toBe("unknown");
  });

  it("describes a non-story placement that was refused without mentioning stories", () => {
    const result = describePublishFailure({
      error: "[facebook_feed_publish] status=400 OAuthException: Stories are not supported for this object (code 100)",
      platform: "facebook",
      placement: "feed",
    });

    expect(result?.kind).toBe("placement_not_allowed");
    expect(result?.message).toBe(
      "Facebook would not accept this type of post on your account. Contact Cheers support if it keeps happening.",
    );
  });
});

describe("connectionFailureText", () => {
  it("explains a connection reason in plain words", () => {
    expect(
      connectionFailureText(
        "GraphMethodException: Unsupported post request. Object with ID '100000000000000' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
        "facebook",
      ),
    ).toContain("Cheers can no longer reach your Facebook Page");
    expect(connectionFailureText("GraphMethodException: Authorization Error (code 100)", "instagram")).toContain(
      "Instagram refused access",
    );
  });

  it("reads any other reason as a reconnect, because the worker flagged the connection", () => {
    // Live: an old 9007 failure flagged the Instagram connection.
    expect(connectionFailureText("OAuthException: Media ID is not available (code 9007)", "instagram")).toBe(
      "Cheers can no longer post to Instagram because the connection has expired or been cancelled. Reconnect Instagram on the Connections page, then try again.",
    );
  });

  it("returns null when there is no reason", () => {
    expect(connectionFailureText(null, "facebook")).toBeNull();
    expect(connectionFailureText("", "facebook")).toBeNull();
  });
});
