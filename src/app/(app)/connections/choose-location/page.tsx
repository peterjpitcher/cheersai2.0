import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/PageHeader";
import { LocationChooser } from "@/features/connections/location-chooser";
import { ownedBrandIds } from "@/lib/auth/roles";
import { requireAuthContext } from "@/lib/auth/server";
import { brandHasGooglePosts } from "@/lib/connections/google-access";
import { readGoogleLocationChoice } from "@/lib/connections/google-choice";
import {
  buildGoogleLocationChoiceView,
  GOOGLE_LOCATION_CHOICE_FAILURE_MESSAGES,
  type GoogleLocationChooserState,
} from "@/lib/connections/google-choice-view";
import { createLogger } from "@/lib/logging";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const logger = createLogger("connections");

export const metadata: Metadata = {
  title: "Choose your location | Cheers",
  robots: { index: false, follow: false },
  // The choice reference is in this page's address: never send it to another site.
  referrer: "same-origin",
};

export const dynamic = "force-dynamic";

interface ChooseLocationProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The Google location picker, reached from the OAuth callback. Everything is
 * read on the server from the encrypted hand-off; the browser gets names and
 * addresses only. A brand without Google posting switched on (decision D10)
 * is told only that the choice could not be found.
 */
export default async function ChooseLocation({ searchParams }: ChooseLocationProps) {
  const ctx = await requireAuthContext();
  const params = await searchParams;
  const token = typeof params.choice === "string" ? params.choice : "";

  const result = await readGoogleLocationChoice(createServiceSupabaseClient(), {
    token,
    userId: ctx.user.id,
    ownedAccountIds: ownedBrandIds(ctx),
  });

  let state: GoogleLocationChooserState;
  let description: string | undefined;

  if (result.ok && brandHasGooglePosts(ctx, result.choice.payload.accountId)) {
    const { payload } = result.choice;
    const brandName = ctx.brands.find((brand) => brand.accountId === payload.accountId)?.name ?? null;
    state = { kind: "choose", view: buildGoogleLocationChoiceView({ token, brandName, payload }) };
    description = `Choose the Google location CheersAI should be connected to for ${brandName ?? "this brand"}.`;
  } else {
    const reason = result.ok ? "not_found" : result.reason;
    const details = { reason: result.ok ? "google_posts_off" : result.reason, userId: ctx.user.id };
    if (reason === "lookup_failed") {
      logger.error("could not load the location picker", new Error("oauth_states lookup failed"), details);
    } else if (reason === "used") {
      // Expected after every pick: Next.js re-renders this page once the choice is used up.
      logger.info("location picker shown for a used choice", details);
    } else {
      logger.warn("location picker refused", details);
    }
    state = { kind: "unavailable", message: GOOGLE_LOCATION_CHOICE_FAILURE_MESSAGES[reason] };
  }

  // One tree for every case, so the picker keeps its own state when Next.js
  // re-renders this page after the pick.
  return (
    <div className="flex h-full flex-col gap-6 font-sans">
      <PageHeader title="Choose your location" description={description} />
      <section
        className="max-w-2xl rounded-xl p-4 md:p-6"
        style={{ backgroundColor: "var(--c-card)", border: "1px solid var(--c-line)", boxShadow: "var(--sh-sm)" }}
      >
        <LocationChooser state={state} />
      </section>
    </div>
  );
}
