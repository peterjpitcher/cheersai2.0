import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOME_CONTENT_UPDATED } from "@/content/homepage";
import { LEGAL_UPDATED } from "@/lib/legal/company";
import { CRAWLABLE_FILES } from "@/lib/signup/front-door";
import { ukLongDateToIso } from "@/lib/utils/date";

import { SAMPLE_GUIDES } from "../../tests/fixtures/guides/sample-guides";

/**
 * robots.txt and sitemap.xml name the public pages whatever the sign-up
 * switch says, without reading it (SPEC-homepage-and-guides §3); the legacy
 * /auth/signup URL still follows the switch (SPEC-self-serve-signup §4.1).
 */

const switchState = vi.hoisted(() => vi.fn());
const registry = vi.hoisted(() => ({ guides: [] as import("@/content/guides/types").Guide[] }));
vi.mock("@/lib/signup/switch", () => ({ getSelfServeSignupSwitch: () => switchState() }));
vi.mock("@/content/guides", () => ({ listGuides: () => registry.guides }));
vi.mock("@/env", () => ({
  env: { server: {}, client: { NEXT_PUBLIC_SITE_URL: "https://cheers.orangejelly.co.uk" } },
}));

const { default: robots } = await import("@/app/robots");
const { default: sitemap } = await import("@/app/sitemap");
const { default: LegacySignupRedirectPage } = await import("@/app/auth/signup/page");

const SITE = "https://cheers.orangejelly.co.uk";
const HOME = HOME_CONTENT_UPDATED;
const LEGAL = ukLongDateToIso(LEGAL_UPDATED);

async function redirectOf(run: () => Promise<unknown>): Promise<{ path: string; status: number }> {
  try {
    await run();
  } catch (error) {
    const parts = ((error as { digest?: string }).digest ?? "").split(";");
    if (parts[0] === "NEXT_REDIRECT") return { path: parts[2], status: Number(parts[3]) };
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  switchState.mockReset();
  registry.guides = [];
});

describe("robots.txt", () => {
  it("allows the home page, the legal pages and the guides whatever the switch says, and names the sitemap", async () => {
    for (const state of ["open", "closed", "enforcement_off", "unavailable"]) {
      switchState.mockResolvedValue(state);
      expect(await robots()).toEqual({
        rules: [
          {
            userAgent: "*",
            allow: ["/$", "/terms", "/privacy", "/data-processing", "/guides", ...CRAWLABLE_FILES],
            disallow: "/",
          },
        ],
        sitemap: `${SITE}/sitemap.xml`,
      });
    }
    expect(switchState).not.toHaveBeenCalled();
  });
});

describe("sitemap.xml", () => {
  it("lists the home page and the legal pages, dated by their content, while there are no guides", async () => {
    expect(LEGAL).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await sitemap()).toEqual([
      { url: `${SITE}/`, lastModified: HOME },
      { url: `${SITE}/terms`, lastModified: LEGAL },
      { url: `${SITE}/privacy`, lastModified: LEGAL },
      { url: `${SITE}/data-processing`, lastModified: LEGAL },
    ]);
  });

  it("adds /guides and every guide, each dated by its last update, once there are guides, whatever the switch says", async () => {
    registry.guides = SAMPLE_GUIDES;
    for (const state of ["open", "closed", "enforcement_off", "unavailable"]) {
      switchState.mockResolvedValue(state);
      expect(await sitemap()).toEqual([
        { url: `${SITE}/`, lastModified: HOME },
        { url: `${SITE}/guides`, lastModified: "2026-09-29" },
        { url: `${SITE}/guides/plan-a-week-of-pub-posts`, lastModified: "2026-09-29" },
        { url: `${SITE}/guides/instagram-stories-for-restaurants`, lastModified: "2026-09-10" },
        { url: `${SITE}/terms`, lastModified: LEGAL },
        { url: `${SITE}/privacy`, lastModified: LEGAL },
        { url: `${SITE}/data-processing`, lastModified: LEGAL },
      ]);
    }
    expect(switchState).not.toHaveBeenCalled();
  });
});

describe("/auth/signup", () => {
  it("goes to the login page while the switch is off, unreadable or on without billing enforcement, with a 307", async () => {
    for (const state of ["closed", "enforcement_off", "unavailable"]) {
      switchState.mockResolvedValue(state);
      expect(await redirectOf(() => LegacySignupRedirectPage())).toEqual({ path: "/login", status: 307 });
    }
  });

  it("goes to /signup once the switch is on, with a 307", async () => {
    switchState.mockResolvedValue("open");
    expect(await redirectOf(() => LegacySignupRedirectPage())).toEqual({ path: "/signup", status: 307 });
  });
});
