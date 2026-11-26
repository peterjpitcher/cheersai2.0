"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/server";
import type { AuthContext } from "@/lib/auth/types";
import { EntitlementError, requireEntitledContext } from "@/lib/billing/entitlement-server";
import { activeBrandHasGooglePosts } from "@/lib/connections/google-access";
import { checkGoogleBrand } from "@/lib/google-posts/brands";
import {
  editGoogleVersionWording as editWording,
  getGoogleVersionForContent,
  moveGoogleVersion as move,
  releaseGoogleVersion as release,
  retryGoogleVersion as retry,
  skipGoogleVersion as skip,
  type GoogleVersionChange,
} from "@/lib/google-posts/data";
import type { GoogleVersionView } from "@/lib/google-posts/model";
import { createLogger } from "@/lib/logging";
import { toLoggableError } from "@/lib/logging/to-error";

/**
 * Planner actions for a post's Google version (decision D12), called from the
 * Google section of the post page (src/features/planner/google-version-section.tsx).
 *
 * Each follows the planner's own rules for the signed-in user's ACTIVE brand
 * (an owner or a member of it; editing needs the 'create' entitlement and
 * releasing or retrying needs 'publish', as for the post itself), checks the
 * Google switch and the active Google connection on the server (both, read
 * fresh) and fails closed, and writes only through the
 * service-role client scoped by that brand's account_id.
 */

const logger = createLogger("planner");

const NOT_AVAILABLE = "Google posting is not switched on, or Google is not connected, for this brand.";
const FAILED = "We could not change the Google version. Please try again.";

const contentSchema = z.object({ contentId: z.string().uuid() });
const wordingSchema = z.object({ contentId: z.string().uuid(), summary: z.string().max(10_000) });
/** An instant (ISO, with an offset), or null to follow the Facebook post's time again. */
const moveSchema = z.object({ contentId: z.string().uuid(), scheduledFor: z.string().datetime({ offset: true }).nullable() });

type ActionResult = { success?: boolean; error?: string; version?: GoogleVersionView };

/** The switch in the session AND, read fresh, the switch and an active Google connection. */
async function googleReady(ctx: AuthContext): Promise<boolean> {
  if (!activeBrandHasGooglePosts(ctx)) return false;
  const check = await checkGoogleBrand(ctx.supabase, ctx.accountId);
  return check.ok;
}

function done(result: GoogleVersionChange, contentId: string): ActionResult {
  if (!result.success) return { success: false, error: result.error };
  revalidatePath(`/planner/${contentId}`);
  revalidatePath(`/planner/google/${result.version.id}`);
  revalidatePath("/planner");
  return { success: true, version: result.version };
}

/** The post's Google version for the active brand, or null. */
/** The plan check, with the plan's own reason when it refuses (for example a lapsed subscription). */
async function entitled(
  capability: Parameters<typeof requireEntitledContext>[0],
): Promise<Awaited<ReturnType<typeof requireEntitledContext>> | { error: string }> {
  try {
    return await requireEntitledContext(capability);
  } catch (error) {
    if (error instanceof EntitlementError) return { error: error.message };
    throw error;
  }
}

export async function loadGoogleVersion(payload: unknown): Promise<{ version: GoogleVersionView | null; error?: string }> {
  const parsed = contentSchema.safeParse(payload);
  if (!parsed.success) return { version: null, error: "That post could not be found." };
  const ctx = await requireAuthContext();
  if (!(await googleReady(ctx))) return { version: null };
  try {
    return { version: await getGoogleVersionForContent(ctx.supabase, ctx.accountId, parsed.data.contentId) };
  } catch (error) {
    logger.error("could not read a Google version", toLoggableError(error), { accountId: ctx.accountId });
    return { version: null, error: "We could not load the Google version." };
  }
}

export async function editGoogleVersionWording(payload: unknown): Promise<ActionResult> {
  const parsed = wordingSchema.safeParse(payload);
  if (!parsed.success) return { success: false, error: "That wording could not be saved." };
  const ctx = await entitled("create");
  if ("error" in ctx) return { success: false, error: ctx.error };
  if (!(await googleReady(ctx))) return { success: false, error: NOT_AVAILABLE };
  try {
    return done(await editWording(ctx.supabase, ctx.accountId, parsed.data.contentId, parsed.data.summary), parsed.data.contentId);
  } catch (error) {
    logger.error("could not edit a Google version", toLoggableError(error), { accountId: ctx.accountId });
    return { success: false, error: FAILED };
  }
}

export async function releaseGoogleVersion(payload: unknown): Promise<ActionResult> {
  const parsed = contentSchema.safeParse(payload);
  if (!parsed.success) return { success: false, error: "That post could not be found." };
  const ctx = await entitled("publish");
  if ("error" in ctx) return { success: false, error: ctx.error };
  if (!(await googleReady(ctx))) return { success: false, error: NOT_AVAILABLE };
  try {
    return done(await release(ctx.supabase, ctx.accountId, parsed.data.contentId), parsed.data.contentId);
  } catch (error) {
    logger.error("could not release a Google version", toLoggableError(error), { accountId: ctx.accountId });
    return { success: false, error: FAILED };
  }
}

export async function skipGoogleVersion(payload: unknown): Promise<ActionResult> {
  const parsed = contentSchema.safeParse(payload);
  if (!parsed.success) return { success: false, error: "That post could not be found." };
  const ctx = await requireAuthContext();
  if (!(await googleReady(ctx))) return { success: false, error: NOT_AVAILABLE };
  try {
    return done(await skip(ctx.supabase, ctx.accountId, parsed.data.contentId), parsed.data.contentId);
  } catch (error) {
    logger.error("could not skip a Google version", toLoggableError(error), { accountId: ctx.accountId });
    return { success: false, error: FAILED };
  }
}

export async function retryGoogleVersion(payload: unknown): Promise<ActionResult> {
  const parsed = contentSchema.safeParse(payload);
  if (!parsed.success) return { success: false, error: "That post could not be found." };
  const ctx = await entitled("publish");
  if ("error" in ctx) return { success: false, error: ctx.error };
  if (!(await googleReady(ctx))) return { success: false, error: NOT_AVAILABLE };
  try {
    return done(await retry(ctx.supabase, ctx.accountId, parsed.data.contentId), parsed.data.contentId);
  } catch (error) {
    logger.error("could not retry a Google version", toLoggableError(error), { accountId: ctx.accountId });
    return { success: false, error: FAILED };
  }
}

/** Moves a Google post to its own time, or (with null) back to its Facebook post's time. Needs 'publish', as rescheduling a post does. */
export async function moveGoogleVersion(payload: unknown): Promise<ActionResult> {
  const parsed = moveSchema.safeParse(payload);
  if (!parsed.success) return { success: false, error: "That time could not be read. Choose a date and time." };
  const ctx = await entitled("publish");
  if ("error" in ctx) return { success: false, error: ctx.error };
  if (!(await googleReady(ctx))) return { success: false, error: NOT_AVAILABLE };
  try {
    const when = parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null;
    return done(await move(ctx.supabase, ctx.accountId, parsed.data.contentId, when), parsed.data.contentId);
  } catch (error) {
    logger.error("could not move a Google version", toLoggableError(error), { accountId: ctx.accountId });
    return { success: false, error: FAILED };
  }
}
