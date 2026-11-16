/**
 * What the Google section of the planner post page shows (decision D12).
 * Server only; service-role client from the signed-in context, every query
 * scoped by the active brand's account_id. Read only: every change goes
 * through src/app/(app)/planner/google-version-actions.ts.
 *
 * Nothing Google is read for a brand without the switch in its session, or for
 * a post that cannot have a Google version, so those pages never touch
 * gbp_posts. A failed read hides the controls behind a plain line and never
 * breaks the post page.
 */

import { requireAuthContext } from "@/lib/auth/server";
import type { AuthContext } from "@/lib/auth/types";
import { activeBrandHasGooglePosts } from "@/lib/connections/google-access";
import { checkGoogleBrand } from "@/lib/google-posts/brands";
import { getGoogleVersionForContent } from "@/lib/google-posts/data";
import type { GoogleVersionView } from "@/lib/google-posts/model";
import { postCanHaveGoogleVersion } from "@/lib/google-posts/view-text";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";

const logger = createLogger("planner");

export type GooglePostSection =
  /** No section: the switch is off or this post cannot have a Google version. */
  | { kind: "hidden" }
  /** The switch or the connection could not be read: a plain line, no controls. */
  | { kind: "unavailable" }
  /** Google is not connected (or needs reconnecting): a notice instead of the controls. */
  | { kind: "reconnect"; version: GoogleVersionView | null }
  | { kind: "ready"; version: GoogleVersionView | null };

export interface GoogleSectionPost {
  id: string;
  platform: string | null;
  placement: string | null;
}

type SectionContext = Pick<AuthContext, "supabase" | "accountId"> & { features?: { googlePosts?: boolean } | null };

export async function readGooglePostSection(ctx: SectionContext, post: GoogleSectionPost): Promise<GooglePostSection> {
  if (!activeBrandHasGooglePosts(ctx) || !postCanHaveGoogleVersion(post)) return { kind: "hidden" };

  try {
    const [check, version] = await Promise.all([
      checkGoogleBrand(ctx.supabase, ctx.accountId),
      getGoogleVersionForContent(ctx.supabase, ctx.accountId, post.id),
    ]);
    if (check.ok) return { kind: "ready", version };
    if (check.reason === "switched_off") return { kind: "hidden" };
    if (check.reason === "connection_missing") return { kind: "reconnect", version };
    return { kind: "unavailable" };
  } catch (error) {
    logger.error("could not read the Google section", toLoggableError(error), { accountId: ctx.accountId });
    return { kind: "unavailable" };
  }
}

/** The Google section for one post of the signed-in user's active brand. */
export async function getGooglePostSection(post: GoogleSectionPost): Promise<GooglePostSection> {
  const ctx = await requireAuthContext();
  return readGooglePostSection(ctx, post);
}
