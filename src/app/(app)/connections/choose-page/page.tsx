import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageChooser } from "@/features/connections/page-chooser";
import { ownedBrandIds } from "@/lib/auth/roles";
import { requireAuthContext } from "@/lib/auth/server";
import { readPageChoice } from "@/lib/connections/page-choice";
import {
  buildPageChoiceView,
  PAGE_CHOICE_EXPIRED_FROM_CONNECTIONS,
  PAGE_CHOICE_FAILURE_MESSAGES,
  type PageChooserState,
} from "@/lib/connections/page-choice-view";
import { createLogger } from "@/lib/logging";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const logger = createLogger("connections");

export const metadata: Metadata = {
  title: "Choose your Page | Cheers",
  robots: { index: false, follow: false },
  // The choice reference is in this page's address: never send it to another site.
  referrer: "same-origin",
};

export const dynamic = "force-dynamic";

interface ChoosePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The Page chooser, reached from the OAuth callback when the owner manages
 * several Pages and none is stored, or from Change Page. Everything here is
 * read on the server from the encrypted hand-off; the browser gets names and
 * flags only.
 */
export default async function ChoosePage({ searchParams }: ChoosePageProps) {
  const ctx = await requireAuthContext();
  const params = await searchParams;
  const token = typeof params.choice === "string" ? params.choice : "";

  const result = await readPageChoice(createServiceSupabaseClient(), {
    token,
    userId: ctx.user.id,
    ownedAccountIds: ownedBrandIds(ctx),
  });

  let state: PageChooserState;
  let title = "Choose your Page";
  let description: string | undefined;

  if (result.ok) {
    const { payload } = result.choice;
    const brandName = ctx.brands.find((brand) => brand.accountId === payload.accountId)?.name ?? null;
    const view = buildPageChoiceView({ token, brandName, payload });
    const brand = brandName ?? "this brand";
    state = { kind: "choose", view };

    if (view.provider === "instagram") {
      title = "Choose your Instagram account";
      description = `Instagram accounts are linked to Facebook Pages. Choose the Page whose Instagram account CheersAI should post to for ${brand}.`;
    } else {
      title = "Choose your Facebook Page";
      description = view.changePage
        ? `Choose the Facebook Page CheersAI should post to for ${brand}.`
        : `You manage more than one Facebook Page. Choose the one CheersAI should post to for ${brand}.`;
    }
  } else {
    const details = { reason: result.reason, userId: ctx.user.id, provider: result.provider };
    if (result.reason === "lookup_failed") {
      logger.error("could not load the Page chooser", new Error("oauth_states lookup failed"), details);
    } else if (result.reason === "used") {
      // Expected after every pick: Next.js re-renders this page once the choice is used up.
      logger.info("Page chooser shown for a used choice", details);
    } else {
      logger.warn("Page chooser refused", details);
    }
    // Start again only when the flow's mode is known (the first look at the
    // owner's own expired choice); after that, Back to Connections has both buttons.
    const canStartAgain = result.reason === "expired" && result.changePage !== null;
    state = {
      kind: "unavailable",
      message:
        result.reason === "expired" && !canStartAgain
          ? PAGE_CHOICE_EXPIRED_FROM_CONNECTIONS
          : PAGE_CHOICE_FAILURE_MESSAGES[result.reason],
      provider: result.provider,
      changePage: result.changePage ?? false,
      canStartAgain,
    };
  }

  // One tree for every case, so the chooser keeps its own state when Next.js
  // re-renders this page after the pick.
  return (
    <div className="flex h-full flex-col gap-6 font-sans">
      <PageHeader title={title} description={description} />
      <section
        className="max-w-2xl rounded-xl p-4 md:p-6"
        style={{ backgroundColor: "var(--c-card)", border: "1px solid var(--c-line)", boxShadow: "var(--sh-sm)" }}
      >
        <PageChooser state={state} />
      </section>
    </div>
  );
}
