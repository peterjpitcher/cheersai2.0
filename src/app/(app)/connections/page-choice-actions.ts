"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ownedBrandIds, requireOwnerContext } from "@/lib/auth/roles";
import { FACEBOOK_SCOPE_LIST, type Provider } from "@/lib/connections/oauth";
import { claimPageChoice, readPageChoice } from "@/lib/connections/page-choice";
import { PAGE_CHOICE_FAILURE_MESSAGES } from "@/lib/connections/page-choice-view";
import {
  canChoosePage,
  canPostToInstagram,
  type ManagedPage,
} from "@/lib/connections/page-selection";
import {
  clearProviderTokens,
  linkedPageIdFor,
  loadBrandConnections,
  saveProviderConnection,
  scopesForProvider,
  type BrandConnections,
} from "@/lib/connections/persist";
import {
  buildPageConnection,
  fetchManagedPages,
  type MetaUserAuth,
} from "@/lib/connections/token-exchange";
import { createLogger } from "@/lib/logging";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const logger = createLogger("connections");

const choiceSchema = z.object({
  choice: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  pageId: z.string().regex(/^\d{1,32}$/),
});

export interface PageChoiceActionResult {
  success: boolean;
  error?: string;
  /** The platform the choice was for, so the page can offer Start again. */
  provider?: Provider;
  /** Shown with the success toast (what happened to Instagram). */
  notice?: string;
}

const START_AGAIN = "Please start again.";

/**
 * The owner picked a Page in the chooser. Fails closed at every step: the
 * choice must be theirs, unused and unexpired, the Page one they were shown,
 * still managed by them according to Meta and still one CheersAI can post to.
 * Page tokens are fetched here, on the server, and go straight to the vault.
 */
export async function choosePageForConnection(input: unknown): Promise<PageChoiceActionResult> {
  const parsed = choiceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: PAGE_CHOICE_FAILURE_MESSAGES.not_found };
  }
  const { choice: token, pageId } = parsed.data;

  const ctx = await requireOwnerContext();
  const supabase = createServiceSupabaseClient();

  const read = await readPageChoice(supabase, {
    token,
    userId: ctx.user.id,
    ownedAccountIds: ownedBrandIds(ctx),
  });
  if (!read.ok) {
    const details = { reason: read.reason, userId: ctx.user.id, provider: read.provider };
    if (read.reason === "lookup_failed") {
      logger.error("could not read the Page choice", new Error("oauth_states lookup failed"), details);
    } else {
      logger.warn("Page choice refused", details);
    }
    return { success: false, error: PAGE_CHOICE_FAILURE_MESSAGES[read.reason], provider: read.provider ?? undefined };
  }

  const { payload } = read.choice;
  const { provider, accountId } = payload;
  const context = { accountId, provider, pageId, changePage: payload.changePage };
  const refuse = (error: string, reason: string): PageChoiceActionResult => {
    logger.warn("Page choice refused", { ...context, reason });
    return { success: false, error, provider };
  };

  const shown = payload.pages.find((option) => option.id === pageId);
  if (!shown) {
    return refuse("That Page was not in your list. Start again to see your Pages.", "page_not_shown");
  }

  // Single use: claim it before anything else, so a double submit or a replay stops here.
  let claimed: boolean;
  try {
    claimed = await claimPageChoice(supabase, read.choice);
  } catch (error) {
    logger.error("could not claim the Page choice", toError(error), context);
    return { success: false, error: `We could not finish this. ${START_AGAIN}`, provider };
  }
  if (!claimed) {
    return refuse(PAGE_CHOICE_FAILURE_MESSAGES.used, "already_used");
  }

  // Ask Meta again: the Page must still be managed and still allow posting.
  let pages: ManagedPage[];
  try {
    pages = await fetchManagedPages(payload.userAccessToken);
  } catch (error) {
    logger.warn("Page choice could not re-read the Pages", { ...context, message: toError(error).message });
    return { success: false, error: `We could not check your Pages with Facebook. ${START_AGAIN}`, provider };
  }

  const page = pages.find((candidate) => candidate.id === pageId);
  const pageName = page?.name ?? shown.name ?? "That Page";
  if (!page) {
    return refuse(
      `Your Facebook profile no longer manages ${pageName}, or has not given CheersAI access to it. Start again to choose a Page.`,
      "page_no_longer_managed",
    );
  }
  if (!canChoosePage(provider, page)) {
    return refuse(unusablePageMessage(provider, page, pageName), "page_not_usable");
  }

  let connections: BrandConnections;
  try {
    connections = await loadBrandConnections(supabase, accountId);
  } catch (error) {
    logger.error("could not load connections for the Page choice", toError(error), context);
    return { success: false, error: `We could not check this brand's connections. ${START_AGAIN}`, provider };
  }

  if (provider === "instagram") {
    const facebookPageId = linkedPageIdFor("instagram", connections);
    if (facebookPageId && facebookPageId !== page.id) {
      return refuse(
        "Facebook was connected to a different Page while you were choosing, and Instagram must use the same Page. Start again.",
        "facebook_moved",
      );
    }
  }

  const auth: Pick<MetaUserAuth, "expiresAt" | "metaUserId"> = {
    expiresAt: payload.expiresAt,
    metaUserId: payload.metaUserId,
  };

  const saved = await saveProviderConnection(supabase, {
    accountId,
    provider,
    exchange: buildPageConnection(provider, page, auth),
    scopes: scopesForProvider(provider),
  });
  if (!saved.success) {
    logger.error("could not save the chosen Page", new Error(saved.error ?? "save failed"), context);
    return { success: false, error: saved.error ?? `We could not save this Page. ${START_AGAIN}`, provider };
  }

  let notice: string | undefined;
  if (provider === "facebook") {
    const follow = await keepInstagramOnPage(supabase, { accountId, page, pageName, auth, connections });
    if (!follow.success) {
      revalidateConnections();
      return { success: false, error: follow.error, provider };
    }
    notice = follow.notice;
  }

  logger.info("Page chosen", context);
  revalidateConnections();
  return { success: true, provider, notice };
}

/**
 * Facebook and Instagram use the same Page. After a Facebook choice, a
 * connected Instagram on another Page moves to the new Page's account through
 * the same login (its scopes include Instagram publishing), or is disconnected
 * when the new Page has no account CheersAI can post to. The chooser warned
 * about both before the owner picked.
 */
async function keepInstagramOnPage(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  {
    accountId,
    page,
    pageName,
    auth,
    connections,
  }: {
    accountId: string;
    page: ManagedPage;
    pageName: string;
    auth: Pick<MetaUserAuth, "expiresAt" | "metaUserId">;
    connections: BrandConnections;
  },
): Promise<{ success: true; notice?: string } | { success: false; error: string }> {
  // The same test the chooser used for its warning: Instagram holds a token and
  // records its Page. A legacy row without a Page id is left alone.
  const instagramPageId = linkedPageIdFor("facebook", connections);
  if (!instagramPageId || instagramPageId === page.id) {
    return { success: true };
  }

  if (canPostToInstagram(page)) {
    const saved = await saveProviderConnection(supabase, {
      accountId,
      provider: "instagram",
      exchange: buildPageConnection("instagram", page, auth),
      scopes: [...FACEBOOK_SCOPE_LIST],
    });
    if (!saved.success) {
      logger.error("could not move Instagram to the chosen Page", new Error(saved.error ?? "save failed"), {
        accountId,
        pageId: page.id,
      });
      return {
        success: false,
        error: `Facebook now uses ${pageName}, but Instagram could not be moved to it. Connect Instagram again.`,
      };
    }
    const handle = page.instagram?.username ? `@${page.instagram.username}` : `the account on ${pageName}`;
    return { success: true, notice: `Instagram now uses ${handle}, on the same Page.` };
  }

  const cleared = await clearProviderTokens(supabase, accountId, "instagram");
  if (!cleared.success) {
    logger.error("could not disconnect Instagram after the Page change", new Error("disconnect failed"), {
      accountId,
      pageId: page.id,
    });
    return {
      success: false,
      error: `Facebook now uses ${pageName}. Instagram is still connected to your old Page and could not be disconnected: use Disconnect on the Instagram card.`,
    };
  }
  return {
    success: true,
    notice: `Instagram was disconnected, as ${pageName} has no Instagram account CheersAI can post to.`,
  };
}

function unusablePageMessage(provider: Provider, page: ManagedPage, pageName: string): string {
  if (provider === "instagram" && !page.instagram) {
    return `${pageName} no longer has a linked Instagram professional account. Start again to choose a Page.`;
  }
  return `Your Facebook profile cannot post to ${pageName}. Ask an admin of the Page for content access, or start again to choose another Page.`;
}

function revalidateConnections() {
  revalidatePath("/connections");
  revalidatePath("/");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
