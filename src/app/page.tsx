import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { listGuides } from "@/content/guides";
import { FrontDoorPage } from "@/features/front-door/front-door-page";
import { GUIDES_PATH, guidesVisible, latestGuides } from "@/lib/guides/guides";
import { homeMetadata } from "@/lib/marketing/metadata";
import { currentDeployment, frontDoorCta, frontDoorVisible, indexableWhenOpen } from "@/lib/signup/front-door";
import { getSelfServeSignupSwitch } from "@/lib/signup/switch";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * `/` (SPEC-self-serve-signup §4.1, SPEC-homepage-and-guides).
 *
 * - Signed in: straight to the app with a temporary (307) redirect. The old
 *   permanent 308 is gone so browsers stop caching it.
 * - Signed out, sign-up switch off or unreadable: the login page (307), as
 *   before this change. Nothing new is public until Peter turns the switch on.
 * - Signed out, switch on: the homepage.
 *
 * Vercel Preview and local development show the homepage with the switch
 * off, so the copy can be approved on the PR preview (see front-door.ts). The
 * guides links appear only while the guides themselves are public.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const state = await getSelfServeSignupSwitch();
  // A closed front door is only a redirect to /login: its response must carry
  // nothing new (no title, no price), so it keeps the site-wide metadata.
  if (!frontDoorVisible(state, currentDeployment())) return {};
  return indexableWhenOpen(homeMetadata(), state);
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

export default async function Home(): Promise<React.JSX.Element> {
  if (await isSignedIn()) {
    redirect("/planner");
  }

  const state = await getSelfServeSignupSwitch();
  if (!frontDoorVisible(state, currentDeployment())) {
    redirect("/login");
  }

  const guides = listGuides();
  const showGuides = guidesVisible(state, guides);
  return (
    <FrontDoorPage
      cta={frontDoorCta(state)}
      guidesHref={showGuides ? GUIDES_PATH : null}
      latestGuides={showGuides ? latestGuides(guides) : []}
    />
  );
}
