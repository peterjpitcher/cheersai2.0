// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bannedClaimsIn } from "@/content/claims";
import { homeFaq } from "@/content/homepage";
import { plainText } from "@/content/rich-text";
import { HOME_SEO } from "@/content/seo";
import { EXAMPLE_WEEK_POSTS } from "@/features/front-door/planner-illustration";
import { PLANS, TRIAL_PLAN } from "@/lib/billing/plans";
import { WEEKLY_MAX_OCCURRENCES } from "@/lib/constants";
import type { SelfServeSignupSwitch } from "@/lib/signup/switch";

import { SAMPLE_GUIDES } from "../../tests/fixtures/guides/sample-guides";

/**
 * `/` (SPEC-homepage-and-guides §3): signed-in visitors go to the app with a
 * 307; everyone else sees the homepage, which may be indexed whatever the
 * sign-up switch says. It shows prices from PLANS, each "ex VAT", never
 * mentions paid ads or tournaments, offers sign-up only when the switch is
 * open ("Talk to us" otherwise), and links the guides once there are guides.
 */
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  switchState: vi.fn(),
  serverEnv: { VERCEL_ENV: "production" } as Record<string, string>,
  guides: [] as import("@/content/guides/types").Guide[],
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
vi.mock("@/content/guides", () => ({ listGuides: () => mocks.guides }));

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

/** Every JSON-LD object on the page, with @graph members flattened out. */
function jsonLd(container: HTMLElement): Record<string, unknown>[] {
  return Array.from(container.querySelectorAll('script[type="application/ld+json"]')).flatMap((script) => {
    const data = JSON.parse(script.textContent ?? "{}") as Record<string, unknown>;
    return Array.isArray(data["@graph"]) ? (data["@graph"] as Record<string, unknown>[]) : [data];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverEnv.VERCEL_ENV = "production";
  mocks.guides = [];
});
afterEach(cleanup);

describe("/ for a signed-in visitor", () => {
  it("goes straight to the app with a temporary (307) redirect", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.switchState.mockResolvedValue("open");

    expect(await redirectOf(() => Home())).toEqual({ path: "/planner", status: 307 });
  });
});

describe("/ while sign-up is closed, or the switch cannot be read", () => {
  it("shows a signed-out visitor the homepage with Talk to us and never offers sign-up", async () => {
    for (const state of ["closed", "enforcement_off", "unavailable"] as const) {
      signedOut(state);
      const { container, text, html } = await renderHome();

      expect(text).toContain("Talk to us");
      expect(text).not.toContain("Start your free trial");
      expect(hrefs(container)).not.toContain("/signup");
      expect(html).toContain('href="mailto:peter@orangejelly.co.uk"');
      expect(text).toContain("07990 587315");
      cleanup();
    }
  });

  it("keeps Sign in in the header for existing venues", async () => {
    signedOut("closed");
    const { container } = await renderHome();
    const header = container.querySelector("header");

    expect(header?.textContent).toContain("Sign in");
    expect(Array.from(header?.querySelectorAll("a") ?? []).map((a) => a.getAttribute("href"))).toContain("/login");
  });

  it("treats a session that cannot be read as signed out", async () => {
    mocks.getUser.mockRejectedValue(new Error("supabase down"));
    mocks.switchState.mockResolvedValue("closed");
    const { text } = await renderHome();
    expect(text).toContain("Talk to us");
  });

  it("has the same indexable metadata as when sign-up is open, without reading the switch", async () => {
    mocks.switchState.mockResolvedValue("closed");
    const metadata = await generateMetadata();
    expect(metadata.title).toBe(HOME_SEO.title);
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(mocks.switchState).not.toHaveBeenCalled();
  });

  it("shows the same on a Vercel Preview as in production", async () => {
    mocks.serverEnv.VERCEL_ENV = "preview";
    signedOut("closed");
    const { text } = await renderHome();
    expect(text).toContain("Talk to us");
  });
});

describe("/ in production once the sign-up switch is on", () => {
  it("shows the homepage with Start your free trial, and no Talk to us", async () => {
    signedOut("open");
    const { container, text } = await renderHome();

    expect(text).toContain("Start your free trial");
    expect(text).not.toContain("Talk to us");
    expect(hrefs(container)).toContain("/signup");
  });

  it("has a header with Sign in and the call to action", async () => {
    signedOut("open");
    const { container } = await renderHome();
    const header = container.querySelector("header");

    expect(header?.textContent).toContain("Sign in");
    expect(header?.textContent).toContain("Start your free trial");
    expect(Array.from(header?.querySelectorAll("a") ?? []).map((a) => a.getAttribute("href"))).toEqual(
      expect.arrayContaining(["/login", "/signup"]),
    );
  });

  it("has its own title, description, canonical URL and share cards, and may be indexed", async () => {
    mocks.switchState.mockResolvedValue("open");
    const metadata = await generateMetadata();

    expect(metadata.title).toBe(HOME_SEO.title);
    expect(metadata.description).toContain("From £29.99 a month ex VAT, with a 14-day free trial.");
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe("https://cheers.orangejelly.co.uk/");
    const image = { url: "https://cheers.orangejelly.co.uk/og", width: 1200, height: 630, alt: HOME_SEO.imageAlt };
    expect(metadata.openGraph).toMatchObject({ url: "https://cheers.orangejelly.co.uk/", locale: "en_GB", images: [image] });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: [image] });
  });
});

describe("the guides links on the homepage", () => {
  it("are left out while there are no guides", async () => {
    signedOut("open");
    const { container } = await renderHome();
    expect(hrefs(container).filter((href) => href.startsWith("/guides"))).toEqual([]);
  });

  it("appear in the header, the footer and a newest-guides section once guides exist, whatever the switch says", async () => {
    mocks.guides = SAMPLE_GUIDES;
    for (const state of ["open", "closed", "unavailable"] as const) {
      signedOut(state);
      const { container, text } = await renderHome();

      const header = container.querySelector("header");
      const footer = container.querySelector("footer");
      expect(Array.from(header?.querySelectorAll("a") ?? []).map((a) => a.textContent)).toContain("Guides");
      // The homepage is not the guides section, so nothing in the header is marked current.
      expect(header?.querySelector("[aria-current]")).toBeNull();
      expect(footer?.querySelector('a[href="/guides"]')?.textContent).toBe("Guides");
      expect(text).toContain("Guides for hospitality social media");
      for (const guide of SAMPLE_GUIDES) expect(hrefs(container)).toContain(`/guides/${guide.slug}`);
      cleanup();
    }
  });
});

describe("the homepage content", () => {
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

  it("works out the yearly saving from PLANS", async () => {
    const { container } = await renderHome();
    for (const id of ["starter", "professional"] as const) {
      const { monthlyPricePence, annualPricePence } = PLANS[id];
      const saving = Math.round((1 - (annualPricePence ?? 0) / ((monthlyPricePence ?? 0) * 12)) * 100);
      const cardText = container.querySelector(`[aria-labelledby="plan-${id}"]`)?.textContent ?? "";
      expect(saving).toBeGreaterThan(0);
      expect(cardText).toContain(`Save ${saving}% when you pay yearly`);
    }
  });

  it("states the trial as the terms do", async () => {
    const { text } = await renderHome();
    expect(text).toContain("14-day free trial");
    expect(text).toContain("We take your card details at the start.");
    expect(text).toContain("day 15, unless you cancel before then");
  });

  it("describes weekly regulars as the wizard makes them: every date written up front, up to an end date", async () => {
    const { text } = await renderHome();
    expect(text).toContain("Weekly regulars, set up once");
    expect(text).toContain("Pick the days, a time and an end date.");
    expect(text).toContain(`up to ${WEEKLY_MAX_OCCURRENCES} dates at a time`);
    expect(text).not.toContain("each week for you to check");
  });

  it("says a trial has the trial plan's seats, whichever plan is chosen, wherever it names the seats", async () => {
    const { container } = await renderHome();
    const note = `(${PLANS[TRIAL_PLAN].limits?.seats} during the free trial, whichever plan you choose)`;
    const teamFeature = Array.from(container.querySelectorAll("li")).find(
      (item) => item.querySelector("h3")?.textContent === "Room for your team",
    );
    const teamAnswer = Array.from(container.querySelectorAll("details[data-faq]")).find(
      (item) => item.querySelector("[data-faq-question]")?.textContent === "Can my team use Cheers?",
    );
    expect(teamFeature?.textContent).toContain(note);
    expect(teamAnswer?.textContent).toContain(note);
  });

  it("explains in plain words what counts as a published post and an AI generation", async () => {
    const { text } = await renderHome();
    expect(text).toContain("Each Facebook or Instagram placement counts as a separate published post");
    expect(text).toContain("a post on Facebook and Instagram counts as two");
    expect(text).toContain("An AI generation is Cheers writing or rewriting one post");
  });

  it("draws the example week in day order, counting posts as the plans do", async () => {
    const { container } = await renderHome();
    const picture = container.querySelector('[role="img"]');
    const rows = Array.from(picture?.querySelectorAll("ol > li") ?? []).map((row) => row.textContent ?? "");

    expect(rows.map((row) => row.slice(0, 3))).toEqual(["Mon", "Thu", "Fri"]);
    expect(rows.map((row) => (row.includes("Posted") ? "Posted" : "Scheduled"))).toEqual(["Posted", "Scheduled", "Scheduled"]);
    // Monday on Facebook (1), Thursday's feed post and story on both (4), Friday on both (2).
    expect(EXAMPLE_WEEK_POSTS).toBe(7);
    expect(picture?.textContent).toContain("7 posts, all approved");
    expect(picture?.getAttribute("aria-label")).toContain("7 posts across Facebook and Instagram");
  });

  it("names what a venue needs before starting a trial", async () => {
    const { text } = await renderHome();
    expect(text).toContain("Admin access to your venue's Facebook Page");
    expect(text).toContain("a professional Instagram account linked to that Facebook Page");
  });

  it("names every kind of venue it is for", async () => {
    const { text } = await renderHome();
    for (const venue of ["Pubs", "Bars", "Restaurants", "Cafes", "Hotels"]) expect(text).toContain(venue);
    expect(text).toContain("Other hospitality venue");
  });

  it("never mentions paid ads, tournaments, the management app or any network but Facebook and Instagram", async () => {
    const { text } = await renderHome();
    expect(bannedClaimsIn(text)).toEqual([]);
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

describe("the homepage structured data", () => {
  beforeEach(() => signedOut("open"));

  it("repeats every visible FAQ, question and answer, word for word", async () => {
    const { container } = await renderHome();
    const shown = Array.from(container.querySelectorAll("details[data-faq]")).map((item) => ({
      question: item.querySelector("[data-faq-question]")?.textContent,
      answer: item.querySelector("[data-faq-answer]")?.textContent,
    }));
    const faqPage = jsonLd(container).find((item) => item["@type"] === "FAQPage");
    const inJsonLd = (faqPage?.mainEntity as { name: string; acceptedAnswer: { text: string } }[]).map((entry) => ({
      question: entry.name,
      answer: entry.acceptedAnswer.text,
    }));

    expect(shown.length).toBeGreaterThanOrEqual(8);
    expect(inJsonLd).toEqual(shown);
    expect(shown).toEqual(homeFaq().map((item) => ({ question: item.question, answer: plainText(item.answer) })));
  });

  it("describes the company from company.ts", async () => {
    const { container } = await renderHome();
    const organization = jsonLd(container).find((item) => item["@type"] === "Organization");
    expect(organization).toMatchObject({
      name: "Orange Jelly Limited",
      alternateName: "Cheers",
      url: "https://cheers.orangejelly.co.uk/",
      vatID: "GB315203647",
      identifier: { value: "10537179" },
      email: "peter@orangejelly.co.uk",
    });
  });

  it("offers each plan at its PLANS price, ex VAT, and never Group", async () => {
    const { container } = await renderHome();
    const app = jsonLd(container).find((item) => item["@type"] === "SoftwareApplication");
    const offers = app?.offers as { name: string; price: string; priceCurrency: string; priceSpecification: Record<string, unknown> }[];

    const price = (pence: number | null) => ((pence ?? 0) / 100).toFixed(2);
    expect(offers.map((offer) => [offer.name, offer.price])).toEqual(
      (["starter", "professional"] as const).flatMap((id) => [
        [`${PLANS[id].name}, paid monthly`, price(PLANS[id].monthlyPricePence)],
        [`${PLANS[id].name}, paid yearly`, price(PLANS[id].annualPricePence)],
      ]),
    );
    for (const offer of offers) {
      expect(offer.priceCurrency).toBe("GBP");
      expect(offer.priceSpecification.valueAddedTaxIncluded).toBe(false);
    }
  });
});
