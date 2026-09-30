import type { Metadata } from "next";

import {
  ContactEmail,
  ContactWhatsApp,
  LegalLink,
  LegalList,
  LegalPage,
  LegalSection,
  LegalTable,
} from "@/features/legal/legal-page";
import { COMPANY, LEGAL_DOCUMENTS } from "@/lib/legal/company";
import { indexable } from "@/lib/signup/front-door";
import { SUB_PROCESSOR_ROWS } from "@/lib/legal/sub-processors";

const DESCRIPTION =
  "The Cheers Data Processing Agreement: how Orange Jelly Limited handles personal data for the venues that use Cheers, and the providers it uses.";

const METADATA: Metadata = {
  title: "Data Processing Agreement | Cheers",
  description: DESCRIPTION,
  openGraph: {
    title: "Data Processing Agreement | Cheers",
    description: DESCRIPTION,
    type: "article",
  },
};

// Rendered per request: the header's call to action follows the sign-up
// switch (PublicPage), which must never be baked in at build time.
export const dynamic = "force-dynamic";

/** Public, and search engines may index it (SPEC-homepage-and-guides §3). */
export function generateMetadata(): Metadata {
  return indexable(METADATA);
}

const { terms, privacy } = LEGAL_DOCUMENTS;

const RETENTION_ROWS = [
  [
    "Your content, media, brand details and team members' details",
    "While your account is open. When the account closes, kept for 30 days and then deleted, and gone from backups within a further 7 days.",
  ],
  ["Posts you delete", "Kept in the trash for 7 days, then permanently deleted."],
  ["Publishing history", "24 months."],
  ["Link-in-bio page views and clicks", "24 months."],
  [
    "Booking-tracking identifiers (IP address, browser details, hashed email and phone, Meta click and browser ids)",
    "Cleared 7 days after the booking.",
  ],
  ["Booking facts (event, value, date and campaign tags)", "24 months."],
] as const;

export default function DataProcessingPage() {
  return (
    <LegalPage current="dpa">
      <p>
        This agreement is between {COMPANY.legalName} (&ldquo;we&rdquo;, the processor) and the business that uses
        Cheers (&ldquo;you&rdquo;, the controller). It forms part of our{" "}
        <LegalLink href={terms.path}>{terms.title}</LegalLink>, and you accept it when you accept those terms,
        including by ticking the box at checkout. If you would like a signed copy, email <ContactEmail />.
      </p>

      <LegalSection id="roles" title="1. Who does what">
        <LegalList>
          <li>
            You decide what personal data goes into Cheers and what we do with it for you. For that data, you are the
            controller and we are your processor.
          </li>
          <li>
            We are the controller for our own records about you: your account, sign-in, billing and security. Our{" "}
            <LegalLink href={privacy.path}>{privacy.title}</LegalLink> covers those, not this agreement.
          </li>
          <li>The UK GDPR and the Data Protection Act 2018 apply to this agreement.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="details" title="2. The processing">
        <p>
          <strong>Purpose.</strong> To provide Cheers to you under the terms: storing and preparing your content,
          writing AI suggestions, publishing to your Facebook Page and Instagram account, running your link-in-bio
          page and, if you use it, sending booking data to Meta.
        </p>
        <p>
          <strong>Duration.</strong> For as long as the terms apply, then until we delete the data as set out in
          section 9.
        </p>
        <p>
          <strong>People the data is about.</strong> Your team members; people who appear in or are named in your
          content, such as staff, performers and customers in photos; people who visit your link-in-bio page; and,
          if you use booking tracking, your customers who book.
        </p>
        <p>
          <strong>Types of personal data.</strong>
        </p>
        <LegalList>
          <li>Team members: names, email addresses and roles.</li>
          <li>
            Content: names, photos and videos of people, and any other personal data you add to posts, briefs and
            media.
          </li>
          <li>
            Link-in-bio visits: the page viewed, the links clicked, the time and the referring site. We do not store
            visitors&apos; IP addresses.
          </li>
          <li>
            Booking tracking, only if you use it: booking reference, event, value, date, campaign tags and click ids.
            Only when the customer has given consent on your website, also their IP address, browser details, Meta
            browser and click ids, and their email address and phone number hashed with SHA-256. We only accept
            email addresses and phone numbers already hashed; we never receive them in plain text.
          </li>
        </LegalList>
        <p>
          You should not put special category data, such as health information, into Cheers unless you need to for a
          post.
        </p>
      </LegalSection>

      <LegalSection id="booking-tracking" title="3. Booking tracking and Meta">
        <p>
          If you use booking tracking, we send your booking data to Meta&apos;s Conversions API on your instruction,
          using your own pixel and access token. Meta receives it under Meta&apos;s Business Tools Terms, which are
          between you and Meta. You are responsible for having a lawful basis and the consent your website needs, and
          for telling your customers in your own privacy notice.
        </p>
      </LegalSection>

      <LegalSection id="our-obligations" title="4. What we promise">
        <LegalList>
          <li>
            <strong>Instructions.</strong> We process your personal data only on your documented instructions: these
            terms, this agreement and how you set up and use Cheers. That includes transfers outside the UK. If the
            law requires us to do something else, we will tell you first unless the law forbids it. We will tell you
            if we think an instruction breaks data protection law.
          </li>
          <li>
            <strong>Confidentiality.</strong> Everyone we allow to process your personal data is bound to keep it
            confidential.
          </li>
          <li>
            <strong>Security.</strong> We keep appropriate technical and organisational security measures in place
            (section 6).
          </li>
          <li>
            <strong>Sub-processors.</strong> We use other providers only as set out in section 5.
          </li>
          <li>
            <strong>Rights requests.</strong> We help you respond when people use their data protection rights. If we
            receive a request about your data, we pass it to you.
          </li>
          <li>
            <strong>Breaches.</strong> We tell you without undue delay after we become aware of a personal data breach
            affecting your data, with the information you need to deal with it.
          </li>
          <li>
            <strong>Other help.</strong> We help you with security, breach reporting, data protection impact
            assessments and any consultation with the Information Commissioner&apos;s Office, as far as the
            processing requires.
          </li>
          <li>
            <strong>End of the service.</strong> At the end, we return or delete your personal data, as you choose
            (section 9), unless the law requires us to keep it.
          </li>
          <li>
            <strong>Audits.</strong> We give you the information you need to show that we meet these duties, and we
            allow and contribute to audits by you, or an auditor you appoint, on reasonable request and with
            reasonable notice.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="sub-processors" title="5. Sub-processors">
        <p>You authorise us to use these providers to process your personal data:</p>
        <LegalTable
          caption="Sub-processors"
          head={["Provider", "What they do", "Where", "Transfer safeguard"]}
          rows={SUB_PROCESSOR_ROWS}
        />
        <LegalList>
          <li>
            Each provider is bound by a written contract with data protection duties equivalent to these. We remain
            responsible to you for them.
          </li>
          <li>
            We will give you at least 30 days&apos; notice by email before we add or replace a sub-processor. You can
            object during that time. If we cannot resolve your objection, you can end your subscription before the
            change takes effect.
          </li>
        </LegalList>
        <p>
          <strong>Not sub-processors.</strong> Stripe takes payments and is an independent controller for card data,
          under its own terms. Meta runs the Facebook and Instagram accounts you connect, under Meta&apos;s own terms
          with you; booking data sent to Meta&apos;s Conversions API is covered by the Business Tools Terms between
          you and Meta (section 3).
        </p>
      </LegalSection>

      <LegalSection id="security" title="6. Security measures">
        <LegalList>
          <li>Your data is stored in London, and the app&apos;s code runs in London.</li>
          <li>All traffic to Cheers is encrypted in transit (HTTPS).</li>
          <li>Facebook and Instagram access tokens are encrypted at rest with AES-256-GCM.</li>
          <li>Each brand&apos;s data is kept separate. People can only reach the brands they belong to.</li>
          <li>Owners and team members have different permissions.</li>
          <li>Passwords are handled by our sign-in provider, Supabase. We never store them ourselves.</li>
          <li>Messages from Stripe and Meta are checked for a valid signature before we act on them.</li>
          <li>The database is backed up daily, and backups are kept for 7 days.</li>
          <li>Only authorised Orange Jelly staff can access your data, and only when needed to run or support Cheers.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="your-obligations" title="7. What you promise">
        <LegalList>
          <li>You have a lawful basis for the personal data you put into Cheers or ask us to process.</li>
          <li>
            You give people the information the law requires, and collect any consent needed, including cookie
            consent on your website for booking tracking.
          </li>
          <li>Your instructions to us are lawful.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="transfers" title="8. Transfers outside the UK">
        <p>
          Some sub-processors process data outside the UK, mainly in the United States. We only allow this with the
          safeguard shown for each one in section 5: the UK International Data Transfer Agreement, or the UK Addendum
          to the EU Standard Contractual Clauses. You authorise these transfers.
        </p>
      </LegalSection>

      <LegalSection id="deletion" title="9. Keeping and deleting your data">
        <LegalTable caption="How long we keep data we process for you" head={["Data", "How long"]} rows={RETENTION_ROWS} />
        <p>
          Before we close your account, we can send you an export: a file of your posts, schedule, brand profile and
          link-in-bio page, with download links to your media that last 7 days. Posts already published stay on
          Facebook and Instagram until you delete them there.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="10. Liability and precedence">
        <LegalList>
          <li>The limits of liability in our terms apply to this agreement, as far as the law allows.</li>
          <li>If this agreement and the terms disagree about personal data, this agreement wins.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="contact" title="11. Contact">
        <p>
          Email <ContactEmail /> or message us on WhatsApp at <ContactWhatsApp />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
