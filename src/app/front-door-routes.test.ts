import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOME_CONTENT_UPDATED } from "@/content/homepage";
import { LEGAL_UPDATED } from "@/lib/legal/company";
import { CRAWLABLE_FILES } from "@/lib/signup/front-door";
import { ukLongDateToIso } from "@/lib/utils/date";

import { SAMPLE_GUIDES } from "../../tests/fixtures/guides/sample-guides";

/**
 * robots.txt, sitemap.xml and the legacy /auth/signup URL follow the sign-up
 * switch (SPEC-self-serve-signup §4.1 and P11, SPEC-homepage-and-guides §3).
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
  it("disallows the whole site while the switch is off or unreadable, as before", async () => {
    for (const state of ["closed", "unavailable"]) {
      switchState.mockResolvedValue(state);
      expect(await robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    }
  });

  it("allows the home page, the legal pages and the guides once the switch is on, and names the sitemap", async () => {
    switchState.mockResolvedValue("open");
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
  });
});

describe("sitemap.xml", () => {
  it("is empty while the switch is off or unreadable, even when guides exist", async () => {
    registry.guides = SAMPLE_GUIDES;
    for (const state of ["closed", "unavailable"]) {
      switchState.mockResolvedValue(state);
      expect(await sitemap()).toEqual([]);
    }
  });

  it("lists the home page and the legal pages, dated by their content, while there are no guides", async () => {
    switchState.mockResolvedValue("open");
    expect(LEGAL).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await sitemap()).toEqual([
      { url: `${SITE}/`, lastModified: HOME },
      { url: `${SITE}/terms`, lastModified: LEGAL },
      { url: `${SITE}/privacy`, lastModified: LEGAL },
      { url: `${SITE}/data-processing`, lastModified: LEGAL },
    ]);
  });

  it("adds /guides and every guide, each dated by its last update, once there are guides", async () => {
    registry.guides = SAMPLE_GUIDES;
    switchState.mockResolvedValue("open");
    expect(await sitemap()).toEqual([
      { url: `${SITE}/`, lastModified: HOME },
      { url: `${SITE}/guides`, lastModified: "2026-09-29" },
      { url: `${SITE}/guides/plan-a-week-of-pub-posts`, lastModified: "2026-09-29" },
      { url: `${SITE}/guides/instagram-stories-for-restaurants`, lastModified: "2026-09-10" },
      { url: `${SITE}/terms`, lastModified: LEGAL },
      { url: `${SITE}/privacy`, lastModified: LEGAL },
      { url: `${SITE}/data-processing`, lastModified: LEGAL },
    ]);
  });
});

describe("/auth/signup", () => {
  it("goes to the login page while the switch is off or unreadable, with a 307", async () => {
    for (const state of ["closed", "unavailable"]) {
      switchState.mockResolvedValue(state);
      expect(await redirectOf(() => LegacySignupRedirectPage())).toEqual({ path: "/login", status: 307 });
    }
  });

  it("goes to /signup once the switch is on, with a 307", async () => {
    switchState.mockResolvedValue("open");
    expect(await redirectOf(() => LegacySignupRedirectPage())).toEqual({ path: "/signup", status: 307 });
  });
});
