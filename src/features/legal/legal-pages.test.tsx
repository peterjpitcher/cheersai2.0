// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PrivacyPolicyPage from "@/app/(public)/privacy/page";
import DataProcessingPage from "@/app/data-processing/page";
import TermsPage from "@/app/terms/page";

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
    expect(text).toContain("Version 2026-09-28");
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

describe("the privacy notice", () => {
  it("states how long team invitations are kept, matching the retention job's rule", () => {
    const { container } = render(<PrivacyPolicyPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("Team invitations");
    expect(text).toContain("Deleted a day after the invitation is accepted, declined, cancelled or expires.");
  });
});
