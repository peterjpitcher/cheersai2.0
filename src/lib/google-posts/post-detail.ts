/**
 * Everything the planner shows for one Google post: on its own page
 * (/planner/google/[id]) and in the planner drawer, which must show the same
 * thing (tasks/SPEC-gbp-separate-posts.md, decisions D14 and D16).
 *
 * Server only. The Google post is read by its own id for the ACTIVE brand only
 * (service-role client scoped by account_id), and only when that brand's
 * Google switch is on; anything else is null, never another brand's post. Its
 * picture and default time come from the Facebook post it was made from.
 */

import type { AuthContext } from "@/lib/auth/types";
import { activeBrandHasGooglePosts } from "@/lib/connections/google-access";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { getGoogleVersionById } from "@/lib/google-posts/data";
import type { GoogleVersionView } from "@/lib/google-posts/model";
import { readGooglePostSection, type GooglePostSection } from "@/lib/google-posts/post-section";
import { getPlannerContentDetail } from "@/lib/planner/data";
import { getOwnerSettings } from "@/lib/settings/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Browser-safe: no token, and the picture is a short-lived signed link. */
export interface GooglePostDetail {
  version: GoogleVersionView;
  /** The Google section as the post page shows it (never "hidden" here). */
  section: Exclude<GooglePostSection, { kind: "hidden" }>;
  title: string;
  /** When it goes out now (ISO): its own time, else its Facebook post's. Null when neither is set. */
  currentTime: string | null;
  /** The picture it is sent with, or null when it has none. */
  imageUrl: string | null;
  /** The Facebook post it was made from, or null when that post has been removed. */
  parentId: string | null;
  timezone: string;
  timezoneLabel: string;
}

type DetailContext = Pick<AuthContext, "supabase" | "accountId"> & { features?: { googlePosts?: boolean } | null };

export async function readGooglePostDetail(ctx: DetailContext, id: string): Promise<GooglePostDetail | null> {
  if (!UUID.test(id) || !activeBrandHasGooglePosts(ctx)) return null;

  const version = await getGoogleVersionById(ctx.supabase, ctx.accountId, id);
  if (!version) return null;

  // The Facebook post it was made from: its picture, its time and its wording.
  // It can be missing (binned), in which case the Google post is shown alone.
  const parent = await getPlannerContentDetail(version.contentItemId);
  const ownerSettings = await getOwnerSettings();
  const timezone = ownerSettings.posting.timezone ?? DEFAULT_TIMEZONE;

  // With the Facebook post to hand, the section shows the wording Google will
  // get as it stands now; without it, what is stored.
  const read: GooglePostSection = parent
    ? await readGooglePostSection(ctx, { id: parent.id, platform: parent.platform, placement: parent.placement, body: parent.body })
    : { kind: "ready", version };
  // The switch was on a moment ago; if it has just gone off, show the stored post without controls.
  const section = read.kind === "hidden" ? ({ kind: "unavailable" } as const) : read;

  return {
    version,
    section,
    title: version.eventTitle ?? parent?.campaign?.name ?? "Google post",
    currentTime: version.ownTime ?? parent?.scheduledFor ?? null,
    imageUrl: parent?.media.find((media) => media.mediaType === "image")?.url ?? null,
    parentId: parent?.id ?? null,
    timezone,
    timezoneLabel: timezone.replace(/_/g, " "),
  };
}
