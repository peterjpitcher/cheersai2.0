// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLANS } from "@/lib/billing/plans";
import type { SelfServeSignupSwitch } from "@/lib/signup/switch";

/**
 * `/` (SPEC-self-serve-signup §4.1, PR 3 tests): signed-in visitors go to the
 * app with a 307; while the sign-up switch is off or unreadable, production
 * behaves as before (the login page); the landing page shows prices from
 * PLANS, each "ex VAT", never mentions paid ads or tournaments, and offers
 * sign-up only when the switch is on.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  switchState: vi.fn(),
  serverEnv: { VERCEL_ENV: "production" } as Record<string, string>,
}));

vi.mock("@/env", () => ({
  env: { server: mocks.serverEnv, client: { NEXT_PUBLIC_SITE_URL: "https://cheers.orangejelly.co.uk" } },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/signup/switch", () => ({
  getSelfServeSignupSwitch: () => mocks.switchState(),
}));

const { default: Home, generateMetadata } = await import("@/app/page");

/** Next's redirect() throws; its digest carries the path and the status code. */
async function redirectOf(run: () => Promise<unknown>): Promise<{ path: string; status: number }> {
  try {
    await run();
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    const parts = digest.split(";");
    if (parts[0] === "NEXT_REDIRECT") return { path: parts[2], status: Number(parts[3]) };
    throw error;
  }
  throw new Error("expected a redirect");
}

function signedOut(state: SelfServeSignupSwitch) {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.switchState.mockResolvedValue(state);
}

async function renderHome() {
  const element = await Home();
  const { container } = render(element);
  return { container, text: container.textContent ?? "", html: container.innerHTML };
}

function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverEnv.VERCEL_ENV = "production";
});
afterEach(cleanup);

describe("/ for a signed-in visitor", () => {
  it("goes straight to the app with a temporary (307) redirect", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.switchState.mockResolvedValue("open");

    expect(await redirectOf(() => Home())).toEqual({ path: "/planner", status: 307 });
  });
});

describe("/ in production while the sign-up switch is off", () => {
  it("sends a signed-out visitor to the login page, as before, with a 307", async () => {
    signedOut("closed");
    expect(await redirectOf(() => Home())).toEqual({ path: "/login", status: 307 });
  });

  it("does the same when the switch cannot be read", async () => {
    signedOut("unavailable");
    expect(await redirectOf(() => Home())).toEqual({ path: "/login", status: 307 });
  });

  it("does the same when the switch is on but billing enforcement is off", async () => {
    signedOut("enforcement_off");
    expect(await redirectOf(() => Home())).toEqual({ path: "/login", status: 307 });
  });

  it("treats a session that cannot be read as signed out", async () => {
    mocks.getUser.mockRejectedValue(new Error("supabase down"));
    mocks.switchState.mockResolvedValue("closed");
    expect(await redirectOf(() => Home())).toEqual({ path: "/login", status: 307 });
  });

  it("keeps the site-wide metadata: no new title, no price, still noindex", async () => {
    for (const state of ["closed", "enforcement_off", "unavailable"] as const) {
      mocks.switchState.mockResolvedValue(state);
      const metadata = await generateMetadata();
      expect(metadata).toEqual({});
      expect(JSON.stringify(metadata)).not.toMatch(/£|ex VAT|Social media for hospitality venues/);
    }
  });
});

describe("/ in production once the sign-up switch is on", () => {
  it("shows the landing page with Start your free trial, and no Talk to us", async () => {
    signedOut("open");
    const { container, text } = await renderHome();

    expect(text).toContain("Start your free trial");
    expect(text).not.toContain("Talk to us");
    expect(hrefs(container)).toContain("/signup");
  });

  it("has its own title and description, and may be indexed", async () => {
    mocks.switchState.mockResolvedValue("open");
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Cheers by Orange Jelly | Social media for hospitality venues");
    expect(metadata.description).toContain("From £29.99 a month ex VAT, with a 14-day free trial.");
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });
});

describe("/ on a Vercel Preview (copy approval) while the switch is off", () => {
  beforeEach(() => {
    mocks.serverEnv.VERCEL_ENV = "preview";
  });

  it("shows the landing page with Talk to us and never offers sign-up", async () => {
    signedOut("closed");
    const { container, text, html } = await renderHome();

    expect(text).toContain("Talk to us");
    expect(text).not.toContain("Start your free trial");
    expect(hrefs(container)).not.toContain("/signup");
    expect(html).toContain('href="mailto:peter@orangejelly.co.uk"');
    expect(text).toContain("07990 587315");
  });

  it("carries the new title for review but stays noindex", async () => {
    mocks.switchState.mockResolvedValue("closed");
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Cheers by Orange Jelly | Social media for hospitality venues");
    expect(metadata.robots).toBeUndefined();
  });

  it("shows Talk to us when the switch cannot be read", async () => {
    signedOut("unavailable");
    const { container, text } = await renderHome();

    expect(text).toContain("Talk to us");
    expect(hrefs(container)).not.toContain("/signup");
  });

  it("shows Talk to us when the switch is on but billing enforcement is off", async () => {
    signedOut("enforcement_off");
    const { container, text } = await renderHome();

    expect(text).toContain("Talk to us");
    expect(text).not.toContain("Start your free trial");
    expect(hrefs(container)).not.toContain("/signup");
  });
});

describe("the landing page content", () => {
  beforeEach(() => signedOut("open"));

  it("takes every price from PLANS and marks each one ex VAT", async () => {
    const { container, text } = await renderHome();
    const pounds = (pence: number | null) => `£${((pence ?? 0) / 100).toFixed(2)}`;

    for (const id of ["starter", "professional"] as const) {
      const plan = PLANS[id];
      const card = container.querySelector(`[aria-labelledby="plan-${id}"]`);
      const cardText = card?.textContent ?? "";
      expect(cardText).toContain(plan.name);
      expect(cardText).toContain(`${pounds(plan.monthlyPricePence)} a month ex VAT`);
      expect(cardText).toContain(`or ${pounds(plan.annualPricePence)} a year ex VAT`);
      expect(cardText).toContain(`${plan.limits?.postsPerMonth} published posts a month`);
      expect(cardText).toContain(`${plan.limits?.aiGenerationsPerMonth} AI generations a month`);
      expect(cardText).toContain(`${plan.limits?.seats} team seats`);
    }
    const group = container.querySelector('[aria-labelledby="plan-group"]')?.textContent ?? "";
    expect(group).toContain("Contact us");
    expect(text).toContain("All prices are ex VAT. We add VAT at the UK rate.");
    // No price appears that PLANS does not hold (for example a stale one).
    const allowed = new Set(
      Object.values(PLANS).flatMap((plan) => [plan.monthlyPricePence, plan.annualPricePence]).filter((p) => p !== null).map(pounds),
    );
    for (const shown of text.match(/£\d+\.\d{2}/g) ?? []) expect(allowed).toContain(shown);
  });

  it("states the trial as the terms do", async () => {
    const { text } = await renderHome();
    expect(text).toContain("14-day free trial");
    expect(text).toContain("We take your card details at the start.");
    expect(text).toContain("day 15, unless you cancel before then");
  });

  it("names what a venue needs before starting a trial", async () => {
    const { text } = await renderHome();
    expect(text).toContain("Admin access to your venue's Facebook Page");
    expect(text).toContain("a professional Instagram account linked to that Facebook Page");
  });

  it("never mentions paid ads, tournaments or Google", async () => {
    const { text } = await renderHome();
    expect(text).not.toMatch(/\bads?\b|advert|campaign|tournament|google/i);
  });

  it("shows the company details and links to the legal pages, help and sign in", async () => {
    const { container, text } = await renderHome();
    expect(text).toContain("Orange Jelly Limited");
    expect(text).toContain("company number 10537179");
    expect(text).toContain("VAT number GB315203647");
    expect(hrefs(container)).toEqual(
      expect.arrayContaining(["/terms", "/privacy", "/data-processing", "/help", "/login"]),
    );
  });

  it("carries no broken values", async () => {
    const { text, html } = await renderHome();
    expect(html).not.toContain(String.fromCharCode(0x2014));
    for (const bad of ["undefined", "NaN", "Invalid Date", "£0.00", "null"]) expect(text).not.toContain(bad);
  });
});
