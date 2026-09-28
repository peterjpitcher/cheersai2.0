import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FrontDoorPage } from "@/features/front-door/front-door-page";
import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";
import { currentDeployment, frontDoorCta, frontDoorVisible, indexableWhenOpen } from "@/lib/signup/front-door";
import { getSelfServeSignupSwitch } from "@/lib/signup/switch";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * `/` (SPEC-self-serve-signup §4.1).
 *
 * - Signed in: straight to the app with a temporary (307) redirect. The old
 *   permanent 308 is gone so browsers stop caching it.
 * - Signed out, sign-up switch off or unreadable: the login page (307), as
 *   before this change. Nothing new is public until Peter turns the switch on.
 * - Signed out, switch on: the landing and pricing page.
 *
 * Vercel Preview and local development show the landing page with the switch
 * off, so the copy can be approved on the PR preview (see front-door.ts).
 */
export const dynamic = "force-dynamic";

function describePage(): string {
  const lead = "Plan, write and publish your venue's Facebook and Instagram posts.";
  const pence = PLANS.starter.monthlyPricePence;
  if (pence === null) return `${lead} ${TRIAL_DAYS}-day free trial.`;
  const price = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
  return `${lead} From ${price} a month ex VAT, with a ${TRIAL_DAYS}-day free trial.`;
}

const METADATA: Metadata = {
  title: "Cheers by Orange Jelly | Social media for hospitality venues",
  description: describePage(),
};

export async function generateMetadata(): Promise<Metadata> {
  return indexableWhenOpen(METADATA, await getSelfServeSignupSwitch());
}

async function isSignedIn(): Promise<boolean> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    // No session can be read (for example Supabase is down): treat as signed out.
    return false;
  }
}

export default async function Home() {
  if (await isSignedIn()) {
    redirect("/planner");
  }

  const state = await getSelfServeSignupSwitch();
  if (!frontDoorVisible(state, currentDeployment())) {
    redirect("/login");
  }

  return <FrontDoorPage cta={frontDoorCta(state)} />;
}
