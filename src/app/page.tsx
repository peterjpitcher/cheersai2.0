import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { listGuides } from "@/content/guides";
import { FrontDoorPage } from "@/features/front-door/front-door-page";
import { GUIDES_PATH, guidesVisible, latestGuides } from "@/lib/guides/guides";
import { homeMetadata } from "@/lib/marketing/metadata";
import { frontDoorCta, indexable } from "@/lib/signup/front-door";
import { getSelfServeSignupSwitch } from "@/lib/signup/switch";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * `/` (SPEC-homepage-and-guides §3).
 *
 * - Signed in: straight to the app with a temporary (307) redirect.
 * - Signed out: the homepage, which search engines may index. Its call to
 *   action follows the sign-up switch: "Start your free trial" while sign-up
 *   is open, "Talk to us" otherwise. The guides links appear only once there
 *   are guides.
 */
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return indexable(homeMetadata());
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

  const guides = listGuides();
  const showGuides = guidesVisible(guides);
  return (
    <FrontDoorPage
      cta={frontDoorCta(await getSelfServeSignupSwitch())}
      guidesHref={showGuides ? GUIDES_PATH : null}
      latestGuides={showGuides ? latestGuides(guides) : []}
    />
  );
}
