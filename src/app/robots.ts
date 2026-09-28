import type { MetadataRoute } from "next";

import { robotsFor } from "@/lib/signup/front-door";
import { getSelfServeSignupSwitch } from "@/lib/signup/switch";

/**
 * robots.txt follows the self-serve sign-up switch (SPEC-self-serve-signup
 * P11): while it is off or unreadable, everything stays disallowed, as before;
 * once it is on, search engines may crawl `/` and the three legal pages.
 * Revalidated every minute so a flip reaches crawlers without a deploy.
 */
export const revalidate = 60;

export default async function robots(): Promise<MetadataRoute.Robots> {
  return robotsFor(await getSelfServeSignupSwitch());
}
