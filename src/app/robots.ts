import type { MetadataRoute } from "next";

import { robotsFor, SwitchUnavailableError } from "@/lib/signup/front-door";
import { getSelfServeSignupSwitch } from "@/lib/signup/switch";

/**
 * robots.txt follows the self-serve sign-up switch (SPEC-self-serve-signup
 * P11, SPEC-homepage-and-guides): while it is off, everything stays
 * disallowed, as before; once it is on, search engines may crawl `/`, the
 * three legal pages, the guides and the files they need. When the switch
 * cannot be read it answers a server error rather than "disallow everything":
 * Google caches a 200 robots.txt for up to a day, but retries a failed one and
 * keeps its last good copy meanwhile (front-door.ts). Rendered per request
 * (one small read) so a flip in either direction shows at once, never a stale
 * cached copy.
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const state = await getSelfServeSignupSwitch();
  if (state === "unavailable") throw new SwitchUnavailableError("robots.txt");
  return robotsFor(state);
}
