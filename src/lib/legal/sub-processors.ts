/**
 * The sub-processors named in the DPA and the privacy notice (decision L4,
 * 2026-09-27). Sources, checked 26 September 2026: Supabase project region
 * eu-west-2 and the Supabase DPA (UK Addendum); vercel.json regions lhr1 and
 * the Vercel DPA (UK IDTA, Schedule 5); OpenAI's data controls page and DPA
 * (no training on API data, abuse logs up to 30 days, UK Addendum); Resend's
 * DPA and regions page (sends from eu-west-1, stores in the US, UK Addendum).
 *
 * Upstash and Axiom are left off because neither is configured in production.
 * Adding or replacing one needs 30 days' email notice to customers first.
 */
export interface SubProcessor {
  name: string;
  entity: string;
  purpose: string;
  location: string;
  safeguard: string;
}

export const SUB_PROCESSORS: readonly SubProcessor[] = [
  {
    name: "Supabase",
    entity: "Supabase Pte. Ltd, Singapore",
    purpose: "Database, sign-in and file storage",
    location: "Data stored in London (eu-west-2). Supabase's logs and staff access can be outside the UK.",
    safeguard: "UK Addendum to the EU Standard Contractual Clauses",
  },
  {
    name: "Vercel",
    entity: "Vercel Inc., USA",
    purpose: "Hosting: serves Cheers and runs its code",
    location: "Code runs in London (lhr1). Vercel is a US company and may process data in the US.",
    safeguard: "UK International Data Transfer Agreement",
  },
  {
    name: "OpenAI",
    entity: "OpenAI OpCo, LLC, USA",
    purpose:
      "AI text suggestions, and names and tags for uploaded images. Not used to train OpenAI's models; abuse-monitoring logs kept for up to 30 days.",
    location: "USA",
    safeguard: "UK Addendum to the EU Standard Contractual Clauses",
  },
  {
    name: "Resend",
    entity: "Plus Five Five, Inc., USA",
    purpose: "Sending emails, such as team invitations, password resets and publishing alerts",
    location: "Emails sent from Ireland. Account data, email records and logs stored in the USA.",
    safeguard:
      "UK Addendum to the EU Standard Contractual Clauses. Resend is also certified under the UK Extension to the EU-US Data Privacy Framework.",
  },
];

/** Table rows for the legal pages: provider, purpose, location, safeguard. */
export const SUB_PROCESSOR_ROWS: readonly (readonly string[])[] = SUB_PROCESSORS.map((sub) => [
  `${sub.name} (${sub.entity})`,
  sub.purpose,
  sub.location,
  sub.safeguard,
]);
