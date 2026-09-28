// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PrivacyPolicyPage, { generateMetadata as privacyMetadata } from "@/app/(public)/privacy/page";
import DataProcessingPage, { generateMetadata as dpaMetadata } from "@/app/data-processing/page";
import TermsPage, { generateMetadata as termsMetadata } from "@/app/terms/page";

const switchState = vi.hoisted(() => vi.fn());
vi.mock("@/lib/signup/switch", () => ({ getSelfServeSignupSwitch: () => switchState() }));

/**
 * The three public legal pages render with the company details the law
 * requires on the site (E-Commerce Regulations 2002 reg 6, Trading Disclosures
 * Regulations 2015 reg 25), link to each other, and carry none of the stale
 * details the old privacy page had.
 */

const PAGES = [
  { name: "terms", Page: TermsPage, title: "Terms of Service" },
  { name: "privacy notice", Page: PrivacyPolicyPage, title: "Privacy Notice" },
  { name: "data processing agreement", Page: DataProcessingPage, title: "Data Processing Agreement" },
] as const;

/** Built from its code point so this file itself never contains the character. */
const LONG_DASH = String.fromCharCode(0x2014);

afterEach(cleanup);

describe.each(PAGES)("the $name page", ({ Page, title }) => {
  function renderPage() {
    const { container } = render(<Page />);
    return { container, text: container.textContent ?? "", html: container.innerHTML };
  }

  it("shows its title, date and version", () => {
    const { container, text } = renderPage();
    expect(container.querySelector("h1")?.textContent).toBe(title);
    expect(text).toContain("Last updated 28 September 2026");
    expect(text).toContain("Version 2026-09-28.3");
  });

  it("shows the company details and contacts", () => {
    const { text, html } = renderPage();
    expect(text).toContain("Orange Jelly Limited");
    expect(text).toContain("England and Wales");
    expect(text).toContain("company number 10537179");
    expect(text).toContain("College House, 17 King Edwards Road, Ruislip HA4 7AE");
    expect(text).toContain("Horton Road, Stanwell Moor Village, Surrey TW19 6AQ");
    expect(text).toContain("VAT number GB315203647");
    expect(html).toContain('href="mailto:peter@orangejelly.co.uk"');
    expect(text).toContain("07990 587315");
  });

  it("links to all three legal pages", () => {
    const { container } = renderPage();
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/terms", "/privacy", "/data-processing"]));
  });

  it("carries no stale or broken details", () => {
    const { text, html } = renderPage();
    expect(html).not.toContain(LONG_DASH);
    for (const stale of ["Shelton", "4577", "020 ", "undefined", "NaN", "Invalid Date", "European Union and United States"]) {
      expect(text).not.toContain(stale);
    }
  });
});

describe("the terms", () => {
  it("state the approved prices, trial and refund rules", () => {
    const { container } = render(<TermsPage />);
    const text = container.textContent ?? "";
    for (const fact of ["£29.99", "£323.89", "£59.99", "£647.89", "14-day free trial", "day 15", "CHEERS ORANGE JELLY"]) {
      expect(text).toContain(fact);
    }
    expect(text).toContain("We do not refund part of a month or year");
    expect(text).toContain("at least 30 days");
  });
});

describe("the self-serve wording (spec §4.13), true while sign-up is closed", () => {
  function textOf(Page: typeof TermsPage) {
    const { container } = render(<Page />);
    return container.textContent ?? "";
  }

  it("the terms allow refusing a repeat trial by card and closing a never-started sign-up", () => {
    const text = textOf(TermsPage);
    expect(text).toContain("We may refuse a second trial, for example when the card has been used for a trial before.");
    expect(text).toContain("If you sign up on our website and no subscription starts within 30 days of signing up, we may close the account.");
  });

  it("the privacy notice describes sign-up records, Turnstile and trial card codes only conditionally", () => {
    const text = textOf(PrivacyPolicyPage);
    expect(text).toContain("Sign-up records, if you sign up on our website");
    // Supabase's security log writes user_invited (each sign-up link) with the typed email.
    expect(text).toContain(
      "Our sign-in provider's security log also records the email address you typed and the time of each sign-up link we send you",
    );
    expect(text).toContain("If you use the sign-up form on our website, Cloudflare Turnstile checks your IP address and browser details");
    expect(text).toContain("as an independent controller to improve Turnstile");
    expect(text).toContain("If you start a free trial, we may also keep a one-way code");
    expect(text).toContain("Legitimate interests (one free trial per business).");
  });

  it("the privacy notice lists the retention periods Peter approved (P6, P7)", () => {
    const text = textOf(PrivacyPolicyPage);
    for (const period of [
      "24 months after you asked to sign up.",
      "Deleted if the email address is not confirmed within 7 days, or if no venue is created within 30 days of confirming it.",
      "24 months from the start of the trial.",
      "If you signed up on our website and no subscription starts within 30 days, we may close the account then.",
    ]) {
      expect(text).toContain(period);
    }
  });

  it("the privacy notice states how long team invitations are kept, matching the retention job's rule 13", () => {
    const text = textOf(PrivacyPolicyPage);
    expect(text).toContain("Team invitations");
    expect(text).toContain("Deleted a day after the invitation is accepted, declined, cancelled or expires.");
  });

  it("the DPA adds no sub-processor: Cloudflare is not one", () => {
    expect(textOf(DataProcessingPage)).not.toContain("Cloudflare");
  });
});

describe("legal page indexing follows the sign-up switch (P11)", () => {
  const METADATA = [termsMetadata, privacyMetadata, dpaMetadata];

  it("keeps the site-wide noindex while the switch is off or unreadable", async () => {
    for (const state of ["closed", "unavailable"]) {
      switchState.mockResolvedValue(state);
      for (const generate of METADATA) expect((await generate()).robots).toBeUndefined();
    }
  });

  it("may be indexed once the switch is on, keeping each page's title", async () => {
    switchState.mockResolvedValue("open");
    for (const generate of METADATA) {
      const metadata = await generate();
      expect(metadata.robots).toEqual({ index: true, follow: true });
      expect(String(metadata.title)).toMatch(/\| Cheers$/);
    }
  });
});
