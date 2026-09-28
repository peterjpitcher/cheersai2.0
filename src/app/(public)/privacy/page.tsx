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
import { indexableWhenOpen } from "@/lib/signup/front-door";
import { getSelfServeSignupSwitch } from "@/lib/signup/switch";
import { SUB_PROCESSOR_ROWS } from "@/lib/legal/sub-processors";

const DESCRIPTION =
  "How Orange Jelly Limited, trading as Cheers, uses personal data: what we collect, why, who we share it with, how long we keep it and your rights.";

const METADATA: Metadata = {
  title: "Privacy Notice | Cheers",
  description: DESCRIPTION,
  openGraph: {
    title: "Privacy Notice | Cheers",
    description: DESCRIPTION,
    type: "article",
  },
};

/**
 * Indexable only once the self-serve sign-up switch is on (P11); until then it
 * keeps the site-wide noindex. Rendered per request (one small read) so a flip
 * in either direction shows at once, never a stale cached copy.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return indexableWhenOpen(METADATA, await getSelfServeSignupSwitch());
}

const { terms, dpa } = LEGAL_DOCUMENTS;

const PURPOSE_ROWS = [
  [
    "Account and sign-in details: name, email address, role and the brands you belong to. Your password is handled by our sign-in provider; we never store it ourselves.",
    "To create your account, sign you in and manage your team.",
    "Contract with the business that signs up. For team members a venue adds: our legitimate interest in letting the venue give its team access.",
  ],
  [
    "Sign-in history: sign-ins, sign-outs and password changes, with your email address.",
    "To keep accounts secure and look into problems.",
    "Legitimate interests (security).",
  ],
  [
    "Sign-up records, if you sign up on our website: when you asked to sign up, confirmed your email address, confirmed you are signing up for a business and created your venue, and the version of our terms shown to you.",
    "To run sign-up and see where people stop before finishing it.",
    "Legitimate interests.",
  ],
  [
    "Sign-up form checks, if you use the sign-up form on our website: your IP address and browser details, which Cloudflare Turnstile checks to tell people from automated programs (section 4).",
    "To stop automated sign-ups and protect the emails we send.",
    "Legitimate interests (security).",
  ],
  [
    "Billing details: business name, billing address, VAT number, billing email, plan, subscription status and invoices. If you start a free trial, we may also keep a one-way code made from the identifier Stripe gives your card; it cannot be turned back into your card number.",
    "To take payment and keep tax records, and to keep to one free trial per business. Stripe collects and holds card details; we never see your full card number.",
    "Contract. Legal obligation (tax records). Legitimate interests (one free trial per business).",
  ],
  [
    "Your venue's details and content: brand profile, posts, briefs, photos and videos.",
    "To provide Cheers.",
    "Contract. Where your content includes other people's personal data, we handle it for the venue under our Data Processing Agreement.",
  ],
  [
    "Facebook and Instagram connection details (section 7).",
    "To publish your posts and handle Meta deletion requests.",
    "Contract. Legitimate interests (keeping proof that deletion requests were handled).",
  ],
  [
    "Messages you send us by email or WhatsApp.",
    "To give support and handle complaints.",
    "Contract. Legitimate interests.",
  ],
  [
    "Service emails we send you: team invitations, password resets and alerts about failed posts or connection problems.",
    "To run your account and tell you when something needs your attention.",
    "Contract. Legitimate interests.",
  ],
  [
    "Technical data: IP address, browser and device details and the pages requested.",
    "To run Cheers, keep it secure and fix faults.",
    "Legitimate interests.",
  ],
  [
    "Records of actions: publishing history, who did what in Cheers, and our own admin actions.",
    "To show what happened, keep Cheers secure and resolve disputes.",
    "Legitimate interests.",
  ],
] as const;

const RETENTION_ROWS = [
  [
    "Account and content",
    "For the life of your subscription. If a subscription ends and the account is not closed, we review it 90 days later and may close it then. If you signed up on our website and no subscription starts within 30 days, we may close the account then. Deleted within 30 days after the account closes, and gone from backups within a further 7 days.",
  ],
  ["Sign-up records", "24 months after you asked to sign up."],
  [
    "An account from a sign-up that was not finished",
    "Deleted if the email address is not confirmed within 7 days, or if no venue is created within 30 days of confirming it.",
  ],
  ["Free trial card codes", "24 months from the start of the trial."],
  ["Posts you delete", "Kept in the trash for 7 days, then permanently deleted."],
  [
    "Invoices and payment records",
    "6 years, as HMRC requires. Stripe keeps card data under its own terms. Closing your account does not delete your customer record at Stripe.",
  ],
  ["Messages you send us by email or WhatsApp", "24 months after the conversation ends."],
  ["Notifications in Cheers", "12 months."],
  ["Publishing history and audit logs, including sign-in history", "24 months."],
  ["Link-in-bio page views and clicks", "24 months."],
  [
    "Booking-tracking identifiers (IP address, browser details, hashed email and phone, Meta click and browser ids)",
    "Cleared 7 days after the booking. The booking facts (event, value, date and campaign tags) are kept for 24 months.",
  ],
  ["Meta data-deletion records and our admin actions", "6 years."],
  [
    "Expired temporary security records, such as sign-in rate limits and expired sign-in states",
    "Deleted within a day of expiring.",
  ],
  ["Hosting logs", "1 day."],
  ["Database logs", "7 days."],
  ["Database backups", "7 days."],
] as const;

const COOKIE_ROWS = [
  [
    "Supabase sign-in cookies (names start with sb-)",
    "Keep you signed in. Strictly necessary.",
    "Up to 400 days, or until you sign out.",
  ],
  [
    "cheersai_active_account",
    "Remembers which brand you are working in. Set only when you switch brand.",
    "1 year, or until you sign out.",
  ],
] as const;

export default function PrivacyPolicyPage() {
  return (
    <LegalPage current="privacy">
      <p>
        This notice explains how {COMPANY.legalName}, trading as Cheers, uses personal data. For the data described
        here, we are the controller.
      </p>

      <LegalSection id="who-we-are" title="1. Who we are">
        <p>
          {COMPANY.legalName} is registered in {COMPANY.registeredIn}, company number {COMPANY.companyNumber}.
          Registered office: {COMPANY.registeredOffice}. Trading address: {COMPANY.tradingAddress}.
        </p>
        <p>
          For anything about your personal data, including requests and complaints, email <ContactEmail /> or message
          us on WhatsApp at <ContactWhatsApp />.
        </p>
      </LegalSection>

      <LegalSection id="who-this-covers" title="2. Who this notice covers">
        <LegalList>
          <li>People who use Cheers: venue owners and their team members.</li>
          <li>People who ask to sign up on our website.</li>
          <li>People who contact us.</li>
          <li>
            People who visit a venue&apos;s link-in-bio page. We count page views and link clicks (the page, the link,
            the time and the referring site) for the venue. We do not store your IP address, but our hosting provider
            processes it to deliver the page.
          </li>
          <li>
            People who book with a venue that uses our booking tracking. We handle that data for the venue, which is
            the controller; see the venue&apos;s own privacy notice.
          </li>
        </LegalList>
        <p>
          When we handle personal data for a venue, such as the content it adds or data about its customers, we act
          as the venue&apos;s processor under our <LegalLink href={dpa.path}>{dpa.title}</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection id="what-and-why" title="3. What we collect, why, and our lawful basis">
        <LegalTable
          caption="What we collect, why and our lawful basis"
          head={["Data", "Why we use it", "Lawful basis"]}
          rows={PURPOSE_ROWS}
        />
        <p>
          Our legitimate interests are keeping Cheers secure and working, preventing misuse (including more than one
          free trial per business), running sign-up and seeing where people stop, letting venues give their team
          access, telling customers about problems with their posts, and keeping proof of what happened, such as
          deletions and admin actions. You can object to this use (section 10).
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="4. Who we share it with">
        <p>We use these providers to run Cheers. They process data only on our instructions:</p>
        <LegalTable
          caption="Our processors"
          head={["Provider", "What they do", "Where", "Transfer safeguard"]}
          rows={SUB_PROCESSOR_ROWS}
        />
        <LegalList>
          <li>
            <strong>Stripe</strong> takes payments. Stripe is an independent controller for card and payment data,
            under its own privacy policy.
          </li>
          {/* Cloudflare's roles are from its Turnstile Privacy Addendum (updated 18 June 2025) and the transfer
              basis from section 6 of its Data Processing Addendum, both read 28 September 2026. */}
          <li>
            <strong>Cloudflare</strong> (Cloudflare, Inc., USA). If you use the sign-up form on our website, Cloudflare
            Turnstile checks your IP address and browser details to tell people from automated programs. Cloudflare
            does this for us, on our instructions. It also uses the same details as an independent controller to
            improve Turnstile, under its own Turnstile privacy terms. Transfers to Cloudflare rely on the UK Extension
            to the EU-US Data Privacy Framework, with the UK Addendum to the EU Standard Contractual Clauses as a
            fallback.
          </li>
          <li>
            <strong>Meta.</strong> When you connect Facebook or Instagram, we send the posts you schedule to your Page
            and account. Meta handles them under its own terms and privacy policy.
          </li>
          <li>
            <strong>Public authorities</strong>, such as HMRC, where the law requires it, and professional advisers,
            such as our accountants, where they need it.
          </li>
        </LegalList>
        <p>We do not sell personal data.</p>
      </LegalSection>

      <LegalSection id="transfers" title="5. Transfers outside the UK">
        <p>
          Our database is in London and Cheers runs in London. Some of our providers are in the United States or can
          access data from outside the UK. We only allow this with the safeguard shown for each provider above: the
          UK International Data Transfer Agreement, the UK Addendum to the EU Standard Contractual Clauses, or the UK
          Extension to the EU-US Data Privacy Framework. Email us for more detail.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="6. How long we keep it">
        <LegalTable caption="How long we keep personal data" head={["Data", "How long"]} rows={RETENTION_ROWS} />
        <p>
          Photos and videos stay until you delete them or your account closes. Posts already published on Facebook
          and Instagram stay there until you delete them on Meta.
        </p>
      </LegalSection>

      <LegalSection id="facebook-and-instagram" title="7. Facebook and Instagram">
        <LegalList>
          <li>
            When an owner connects a Facebook Page or Instagram account, we receive the Page and account ids and
            names, access tokens, and your app-scoped Meta user id. We ask Meta for these permissions:
            pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish
            and business_management.
          </li>
          <li>
            We use this only to publish the posts you schedule, show whether they published, and handle deletion
            requests. We do not sell it or use it for advertising.
          </li>
          <li>Access tokens are stored encrypted at rest (AES-256-GCM).</li>
          <li>
            An owner can disconnect Facebook or Instagram at any time in Connections. Disconnecting deletes the access
            tokens we hold for it.
          </li>
          <li>
            You can also remove Cheers in your Facebook settings, under Apps and websites, and ask for your data to be
            deleted there. Meta sends the request to us at https://{COMPANY.siteHost}/api/social/delete-data. We
            delete the access tokens we hold for you and give you a confirmation code and a link to check the status.
            You can also email us to ask.
          </li>
          <li>Posts already published stay on Facebook and Instagram until you delete them there.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="ai" title="8. AI">
        <LegalList>
          <li>
            We use OpenAI to write post suggestions. We send it your venue details and settings (such as name, tone,
            key phrases, hashtags and signatures) and the briefs you type. We also send photos you upload so it can
            suggest names and tags for them.
          </li>
          <li>We do not send OpenAI any data about a venue&apos;s customers or bookings.</li>
          <li>
            OpenAI does not use this data to train its models. It keeps abuse-monitoring logs for up to 30 days. It
            processes data in the United States, under the UK Addendum to the EU Standard Contractual Clauses.
          </li>
          <li>AI suggestions are drafts. A person decides what is published.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="cookies" title="9. Cookies">
        <p>Cheers sets only these cookies:</p>
        <LegalTable caption="Cookies" head={["Cookie", "What it does", "How long"]} rows={COOKIE_ROWS} />
        <p>
          We also keep one short-lived item in your browser&apos;s session storage to show a message after you
          connect Facebook or Instagram. It is cleared when you close the tab. We do not use analytics or advertising
          cookies.
        </p>
      </LegalSection>

      <LegalSection id="your-rights" title="10. Your rights">
        <p>You have the right to:</p>
        <LegalList>
          <li>ask for a copy of the personal data we hold about you;</li>
          <li>ask us to correct it;</li>
          <li>ask us to delete it, or to restrict how we use it;</li>
          <li>object to how we use it, including where we rely on legitimate interests;</li>
          <li>ask for your data in a portable format.</li>
        </LegalList>
        <p>
          To use any of these rights, email <ContactEmail />. We reply within one month. If we hold the data for a
          venue, we pass your request to the venue.
        </p>
      </LegalSection>

      <LegalSection id="complaints" title="11. Complaints">
        <p>
          If you are unhappy with how we use your personal data, please tell us first: email <ContactEmail />, message
          us on WhatsApp at <ContactWhatsApp />, or write to us at our trading address. We acknowledge complaints
          within 30 days and tell you the outcome without undue delay.
        </p>
        <p>
          You can also complain to the Information Commissioner&apos;s Office (ICO) at{" "}
          <LegalLink href="https://ico.org.uk/make-a-complaint/">ico.org.uk/make-a-complaint</LegalLink> or on 0303
          123 1113.
        </p>
      </LegalSection>

      <LegalSection id="required" title="12. Do you have to give us your data?">
        <p>
          We need your account details and, for a paid plan, your billing details to provide Cheers under our{" "}
          <LegalLink href={terms.path}>{terms.title}</LegalLink>. Without them we cannot provide the service.
          Connecting Facebook or Instagram is your choice, but Cheers cannot publish for you without it.
        </p>
      </LegalSection>

      <LegalSection id="automated-decisions" title="13. Automated decisions">
        <p>We do not make decisions about you by automated means that have legal or similarly significant effects.</p>
      </LegalSection>

      <LegalSection id="children" title="14. Children">
        <p>Cheers is for hospitality businesses and is not meant for anyone under 18.</p>
      </LegalSection>

      <LegalSection id="changes" title="15. Changes to this notice">
        <p>
          We will update this page and its date when this notice changes. We will email customers about significant
          changes.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="16. Contact">
        <p>
          Email <ContactEmail /> or message us on WhatsApp at <ContactWhatsApp />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
