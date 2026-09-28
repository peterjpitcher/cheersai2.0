/**
 * The facts every legal page and the Checkout acceptance text share.
 *
 * Company details approved by Peter on 26 and 27 September 2026 and checked
 * against Companies House (company 10537179). The E-Commerce Regulations 2002
 * (reg 6) and the Trading Disclosures Regulations 2015 (reg 25) require them
 * on the website. Change them here only, never in a page.
 */
export const COMPANY = {
  legalName: "Orange Jelly Limited",
  tradingName: "Cheers",
  registeredIn: "England and Wales",
  companyNumber: "10537179",
  registeredOffice: "College House, 17 King Edwards Road, Ruislip HA4 7AE",
  tradingAddress: "Horton Road, Stanwell Moor Village, Surrey TW19 6AQ",
  vatNumber: "GB315203647",
  siteHost: "cheers.orangejelly.co.uk",
} as const;

/** One contact route for support, privacy requests and complaints. */
export const CONTACT = {
  email: "peter@orangejelly.co.uk",
  whatsappDisplay: "07990 587315",
  whatsappE164: "+447990587315",
} as const;

/**
 * The version and date shown on the terms, the privacy notice and the DPA.
 * Bump both when any of the three changes (a same-day change adds a suffix,
 * such as .2); the Checkout acceptance text quotes
 * the version, so Stripe's record of acceptance names the text accepted.
 */
export const LEGAL_VERSION = "2026-09-28.2";
export const LEGAL_UPDATED = "28 September 2026";

export type LegalDocumentId = "terms" | "privacy" | "dpa";

export interface LegalDocument {
  id: LegalDocumentId;
  title: string;
  path: string;
}

/** The public legal pages. /terms and /privacy are the URLs set in the Meta app. */
export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  terms: { id: "terms", title: "Terms of Service", path: "/terms" },
  privacy: { id: "privacy", title: "Privacy Notice", path: "/privacy" },
  dpa: { id: "dpa", title: "Data Processing Agreement", path: "/data-processing" },
};
