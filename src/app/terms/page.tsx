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

const DESCRIPTION =
  "The terms for using Cheers by Orange Jelly: plans, prices, the free trial, renewal, cancellation, refunds and liability.";

export const metadata: Metadata = {
  title: "Terms of Service | Cheers",
  description: DESCRIPTION,
  openGraph: {
    title: "Terms of Service | Cheers",
    description: DESCRIPTION,
    type: "article",
  },
};

const { dpa, privacy } = LEGAL_DOCUMENTS;

const PLAN_ROWS = [
  ["Price a month", "£29.99", "£59.99", "By agreement"],
  ["Price a year", "£323.89", "£647.89", "By agreement"],
  ["Venues", "1", "1", "Several"],
  ["Published posts a month", "120", "400", "Agreed"],
  ["AI generations a month", "150", "500", "Agreed"],
  ["Media storage", "2 GB", "10 GB", "Agreed"],
  ["Team seats", "2", "5", "Agreed"],
  ["Support", "Email", "Priority email and WhatsApp", "Named contact"],
] as const;

export default function TermsPage() {
  return (
    <LegalPage current="terms">
      <p>
        These terms are the agreement between {COMPANY.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) and the
        business that signs up for Cheers (&ldquo;you&rdquo;). Cheers is our software for planning, writing and
        publishing social media posts for hospitality venues, at {COMPANY.siteHost}.
      </p>
      <p>
        You accept these terms, and our <LegalLink href={dpa.path}>{dpa.title}</LegalLink>, when you tick the box at
        checkout or when you use Cheers. The Data Processing Agreement forms part of these terms.
      </p>

      <LegalSection id="who-we-are" title="1. Who we are">
        <p>
          Cheers is a trading name of {COMPANY.legalName}, registered in {COMPANY.registeredIn} with company number{" "}
          {COMPANY.companyNumber}. Our registered office is {COMPANY.registeredOffice}. Our trading address is{" "}
          {COMPANY.tradingAddress}. Our VAT number is {COMPANY.vatNumber}.
        </p>
        <p>
          For support, questions about these terms or complaints, email <ContactEmail /> or message us on WhatsApp at{" "}
          <ContactWhatsApp />.
        </p>
      </LegalSection>

      <LegalSection id="business-customers" title="2. Business customers only">
        <LegalList>
          <li>
            We sell Cheers only to businesses. By signing up, you confirm that you are acting for your business and
            not as a consumer.
          </li>
          <li>The person who accepts these terms confirms that they can agree to them for the business.</li>
          <li>Each business can have one free trial. We may refuse a second trial.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="the-service" title="3. The service">
        <p>
          Cheers lets you plan, write and schedule posts, get AI-written suggestions, store your photos and videos,
          publish to the Facebook Page and Instagram account you connect, and run a link-in-bio page.
        </p>
      </LegalSection>

      <LegalSection id="plans-and-prices" title="4. Plans and prices">
        <LegalTable caption="Cheers plans" head={["", "Starter", "Professional", "Group"]} rows={PLAN_ROWS} />
        <LegalList>
          <li>Prices exclude VAT. We charge VAT at the UK rate.</li>
          <li>Group plans have a price and limits that we agree with you in writing.</li>
          <li>Each Facebook or Instagram placement counts as a separate published post.</li>
          <li>
            We may enforce these limits in Cheers. If you reach a limit, new work above it may be blocked until your
            next billing month or until you upgrade. Your existing content stays.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="free-trial" title="5. Free trial">
        <LegalList>
          <li>New subscriptions start with a 14-day free trial. We take your card details at the start.</li>
          <li>Your first payment is taken on day 15, unless you cancel before then.</li>
          <li>During the trial, the Starter limits apply, whichever plan you choose.</li>
          <li>If you change plan during the trial, the trial keeps running and nothing is charged until it ends.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="payment-and-renewal" title="6. Payment and renewal">
        <LegalList>
          <li>You pay in advance, monthly or yearly, by card. Stripe processes payments for us.</li>
          <li>Your plan renews automatically at the end of each month or year until you cancel it.</li>
          <li>For annual plans, we email you a reminder before each renewal.</li>
          <li>Charges show on your card statement as CHEERS ORANGE JELLY.</li>
          <li>You can see your invoices in Cheers under Settings, Billing, Manage billing.</li>
          <li>
            If a payment fails, please update your card within 7 days. After that, we may pause creating, editing,
            AI suggestions and publishing until the payment is made. You can still see your content, manage billing
            and ask for an export. Nothing is deleted because of a failed payment.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="changing-plan" title="7. Changing plan">
        <LegalList>
          <li>An upgrade takes effect straight away. We charge the difference for the rest of the current period.</li>
          <li>
            A downgrade takes effect at your next renewal. Your existing content and media stay; only new work above
            the lower limits is blocked.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="cancelling-and-refunds" title="8. Cancelling and refunds">
        <LegalList>
          <li>
            An owner can cancel at any time in Cheers under Settings, Billing, Manage billing, or by emailing us.
          </li>
          <li>
            Cancelling stops the next renewal. It takes effect at the end of the period you have paid for, and you
            keep access until then.
          </li>
          <li>
            We do not refund part of a month or year, including on annual plans. The free trial is your chance to try
            Cheers first.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="your-account" title="9. Your account and team">
        <LegalList>
          <li>Keep your sign-in details safe. You are responsible for what happens under your account.</li>
          <li>Give us accurate details and keep them up to date.</li>
          <li>
            Owners manage billing, team members, Facebook and Instagram connections, and export and deletion
            requests. Team members create, edit and schedule posts.
          </li>
          <li>You are responsible for how your team uses Cheers.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="facebook-and-instagram" title="10. Facebook and Instagram">
        <LegalList>
          <li>
            Cheers publishes through Meta&apos;s tools. You must have the right to manage the Facebook Page and
            Instagram account you connect, and you must follow Meta&apos;s terms and policies.
          </li>
          <li>
            An owner can disconnect Facebook or Instagram at any time in Connections. Disconnecting deletes the access
            tokens we hold for it.
          </li>
          <li>
            Posts already published stay on Facebook and Instagram. If you want them removed, delete them there.
          </li>
          <li>Meta runs Facebook and Instagram, not us. Section 17 explains what that means for our liability.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="ai-content" title="11. AI-written content">
        <LegalList>
          <li>AI suggestions are drafts. AI can get things wrong.</li>
          <li>
            Check every post before it is published. You are responsible for what you publish, including prices,
            dates, offers and any claims.
          </li>
          <li>
            Our <LegalLink href={privacy.path}>{privacy.title}</LegalLink> explains which AI provider we use and
            what we send to it.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="acceptable-use" title="12. Acceptable use">
        <p>You must not use Cheers to:</p>
        <LegalList>
          <li>publish content that is unlawful, misleading, infringing or harmful;</li>
          <li>
            break the UK advertising rules (the CAP Code), including the rules on marketing alcohol, or Meta&apos;s
            policies;
          </li>
          <li>upload photos, videos or text that you do not have the right to use;</li>
          <li>send spam;</li>
          <li>try to access other customers&apos; data, or to break, overload or copy Cheers;</li>
          <li>resell Cheers without our written agreement.</li>
        </LegalList>
        <p>We may remove content or suspend access where we find misuse.</p>
      </LegalSection>

      <LegalSection id="your-content" title="13. Your content">
        <LegalList>
          <li>You keep ownership of the content and media you put into Cheers.</li>
          <li>
            You let us store, copy, process and publish it, only to provide Cheers to you. That includes sending it to
            the providers listed in our <LegalLink href={dpa.path}>{dpa.title}</LegalLink>.
          </li>
          <li>Cheers, its software and its branding belong to {COMPANY.legalName}.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="data-protection" title="14. Data protection">
        <LegalList>
          <li>
            Our <LegalLink href={privacy.path}>{privacy.title}</LegalLink> explains how we use personal data for our
            own purposes, such as your account and billing.
          </li>
          <li>
            Our <LegalLink href={dpa.path}>{dpa.title}</LegalLink> covers the personal data we handle for you, such as
            your team members&apos; details and the booking data you ask us to send to Meta. It forms part of these
            terms. Email us if you would like a signed copy.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="availability" title="15. Availability and changes to Cheers">
        <p>
          We aim to provide a reliable service, but we do not promise that Cheers will always be available or free of
          errors. We may change features, connections and limits as Cheers develops.
        </p>
      </LegalSection>

      <LegalSection id="support" title="16. Support">
        <LegalList>
          <li>
            Starter includes email support. Professional includes priority email and WhatsApp support. Group includes
            a named contact.
          </li>
          <li>We provide support on working days. We reply as soon as we can, but we do not promise a response time.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="liability" title="17. Liability">
        <LegalList>
          <li>
            Nothing in these terms limits liability that the law does not allow us to limit, including for death or
            personal injury caused by negligence, or for fraud.
          </li>
          <li>
            We are not liable for indirect or consequential loss, or for lost profits, lost revenue or lost bookings.
          </li>
          <li>
            We are not liable for anything Meta (Facebook and Instagram) does or fails to do, including outages,
            rejected posts, changes to its tools and restrictions on your accounts.
          </li>
          <li>
            Our total liability to you in any 12 months is limited to the fees you paid us in the previous 12 months.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="ending" title="18. Suspension and closing your account">
        <LegalList>
          <li>
            We may suspend or close your account if you seriously break these terms, including the acceptable use
            rules, or if a payment is still unpaid after the 7 days in section 6.
          </li>
          <li>
            After your subscription ends, you can still sign in to see your content and ask for an export. To close
            your account, an owner can email us.
          </li>
          <li>
            Before we close your account, we can send you an export: a file of your posts, schedule, brand profile and
            link-in-bio page, with download links to your media that last 7 days.
          </li>
          <li>
            We delete your data within 30 days after your account closes, and it is gone from our backups within a
            further 7 days. Some records, such as invoices, are kept longer; our{" "}
            <LegalLink href={privacy.path}>{privacy.title}</LegalLink> lists them.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="changes" title="19. Changes to prices and these terms">
        <p>
          We will give you at least 30 days&apos; notice by email before a change to our prices or these terms takes
          effect. You can cancel before the change takes effect. If you keep using Cheers after that, the change
          applies to you.
        </p>
      </LegalSection>

      <LegalSection id="law" title="20. Law and courts">
        <p>
          These terms are governed by the law of England and Wales. The courts of England and Wales deal with any
          dispute about them.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="21. Contact">
        <p>
          Email <ContactEmail /> or message us on WhatsApp at <ContactWhatsApp />. We send notices to the email
          address on your account.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
