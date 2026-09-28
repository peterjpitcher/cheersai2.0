import type { MetadataRoute } from "next";

import { robotsFor } from "@/lib/signup/front-door";
import { getSelfServeSignupSwitch } from "@/lib/signup/switch";

/**
 * robots.txt follows the self-serve sign-up switch (SPEC-self-serve-signup
 * P11): while it is off or unreadable, everything stays disallowed, as before;
 * once it is on, search engines may crawl `/` and the three legal pages.
 * Rendered per request (one small read) so a flip in either direction shows at
 * once, never a stale cached copy.
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  return robotsFor(await getSelfServeSignupSwitch());
}
