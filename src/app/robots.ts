import type { MetadataRoute } from "next";

import { publicRobots } from "@/lib/signup/front-door";

/**
 * robots.txt (SPEC-homepage-and-guides §3): search engines may crawl the
 * homepage, the guides, the three legal pages and the files they need,
 * whatever the sign-up switch says. Nothing here changes without a deploy.
 */
export default function robots(): MetadataRoute.Robots {
  return publicRobots();
}
