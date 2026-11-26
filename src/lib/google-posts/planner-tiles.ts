/**
 * Google posts as planner tiles (tasks/SPEC-gbp-separate-posts.md, decision
 * D14). Server only; service-role client from the signed-in context, every
 * query scoped by the active brand's account_id.
 *
 * Nothing Google is read for a brand without the switch in its session. A
 * failed read shows the planner without Google tiles and never breaks it.
 *
 * A tile sits on the Google post's own day: its own time once a person has
 * moved it, otherwise its Facebook post's time. Its picture is the Facebook
 * post's, because that is the image Google is sent.
 */

import type { AuthContext } from "@/lib/auth/types";
import { activeBrandHasGooglePosts } from "@/lib/connections/google-access";
import { getDisplayTitle } from "@/lib/content/display-helpers";
import { listGooglePostTiles } from "@/lib/google-posts/data";
import { toGoogleTile } from "@/lib/google-posts/tile";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";
import type { ContentItem } from "@/types/content";

const logger = createLogger("planner");

type TileContext = Pick<AuthContext, "supabase" | "accountId"> & { features?: { googlePosts?: boolean } | null };

export interface GoogleTileOptions {
  /** The content items the calendar already shows for the range. */
  calendarItems: ContentItem[];
  startIso: string;
  endIso: string;
  /** Signed thumbnails by content item id, for the items the calendar shows. */
  thumbnails: Map<string, string>;
  /** Signed thumbnails for Facebook posts outside the range (a Google post moved into it). */
  resolveMissingThumbnails?: (contentItemIds: string[]) => Promise<Map<string, string>>;
}

export async function loadGoogleTiles(ctx: TileContext, options: GoogleTileOptions): Promise<ContentItem[]> {
  if (!activeBrandHasGooglePosts(ctx)) return [];

  try {
    const parents = new Map(
      options.calendarItems
        .filter((item) => item.platform === "facebook" && (item.placement ?? "feed") === "feed")
        .map((item) => [item.id, item]),
    );
    const posts = await listGooglePostTiles(ctx.supabase, ctx.accountId, {
      parentIds: [...parents.keys()],
      startIso: options.startIso,
      endIso: options.endIso,
    });

    const startMs = Date.parse(options.startIso);
    const endMs = Date.parse(options.endIso);
    const placed = posts
      .map((post) => {
        const parent = parents.get(post.contentItemId) ?? null;
        const when = post.ownTime ? new Date(post.ownTime) : (parent?.scheduledAt ?? null);
        return { post, parent, when };
      })
      // A post moved out of the range shows on its own day, in another view.
      .filter(
        (entry): entry is typeof entry & { when: Date } =>
          entry.when !== null && !Number.isNaN(entry.when.getTime()) && entry.when.getTime() >= startMs && entry.when.getTime() <= endMs,
      );

    const missing = placed.filter((entry) => !options.thumbnails.has(entry.post.contentItemId)).map((entry) => entry.post.contentItemId);
    const extra = missing.length && options.resolveMissingThumbnails ? await options.resolveMissingThumbnails(missing) : new Map<string, string>();

    return placed.map(({ post, parent, when }) =>
      toGoogleTile({
        id: post.id,
        accountId: ctx.accountId,
        state: post.state,
        when,
        title: post.eventTitle ?? (parent ? getDisplayTitle(parent) : "Google post"),
        campaignName: parent?.campaignName ?? null,
        thumbnailUrl: options.thumbnails.get(post.contentItemId) ?? extra.get(post.contentItemId) ?? null,
      }),
    );
  } catch (error) {
    logger.error("could not load the Google tiles", toLoggableError(error), { accountId: ctx.accountId });
    return [];
  }
}
