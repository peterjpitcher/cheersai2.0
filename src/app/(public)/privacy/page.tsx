import type { Metadata } from "next";

const UPDATED_AT = "8 February 2025";

export const metadata: Metadata = {
  title: "Privacy Policy | CheersAI",
  description:
    "Learn how CheersAI collects, uses, and safeguards your personal information across our website and product.",
  openGraph: {
    title: "Privacy Policy | CheersAI",
    description:
      "Learn how CheersAI collects, uses, and safeguards your personal information across our website and product.",
    type: "article",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-16 text-slate-800">
      <header className="space-y-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-teal">CheersAI</p>
        <h1 className="text-3xl font-semibold text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: {UPDATED_AT}</p>
      </header>

      <section className="mt-12 space-y-6 text-base leading-relaxed">
        <p>
          CheersAI (“we”, “us”, or “our”) builds tools that help hospitality operators plan and publish their social
          media. We are committed to protecting the privacy of our customers, prospects, and website visitors. This
          policy explains what data we collect, how we use it, and the rights available to you.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">1. Information We Collect</h2>
        <p>We collect information in three ways:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Information you provide</strong> such as contact details when you request a demo, register for an
            account, or communicate with our team.
          </li>
          <li>
            <strong>Product data</strong> including content, media assets, scheduling information, and account metadata
            created or uploaded while using the CheersAI platform.
          </li>
          <li>
            <strong>Usage data</strong> such as device information, IP address, pages visited, and actions taken within
            the product collected through cookies or similar technologies.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold text-slate-900">2. How We Use Information</h2>
        <p>We process personal information to:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Provide, maintain, and improve the CheersAI platform and related services.</li>
          <li>Authenticate users, secure the product, and prevent abuse.</li>
          <li>Respond to enquiries, provide customer support, and send transactional communications.</li>
          <li>Comply with legal obligations and enforce our agreements.</li>
          <li>
            Send product updates or marketing messages where permitted. You may opt out at any time via the unsubscribe
            link or by contacting us.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold text-slate-900">3. Cookies & Tracking</h2>
        <p>
          We use necessary cookies to keep you signed in and optional analytics cookies to understand how the product is
          used. You can control analytics cookies via your browser settings. Disabling cookies may impact certain
          features.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">4. Data Sharing & Processors</h2>
        <p>
          We do not sell personal data. We share information only with trusted service providers who assist with hosting,
          analytics, payment processing, customer support, or authentication. These processors only use data on our
          behalf and under contract. We may disclose information if required to comply with law or protect our rights.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">5. International Transfers</h2>
        <p>
          CheersAI operates in the United Kingdom and uses infrastructure hosted in the European Union and United
          States. Where data leaves the UK/EEA we rely on appropriate safeguards such as Standard Contractual Clauses.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">6. Data Retention</h2>
        <p>
          We retain personal data for as long as you have an active relationship with CheersAI and for a reasonable
          period thereafter to comply with legal obligations, resolve disputes, and enforce agreements. You may request
          deletion at any time—see “Your Rights” below.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">7. Your Rights</h2>
        <p>If you reside in the UK or EU, you have the right to:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Request access to the personal data we hold about you.</li>
          <li>Ask us to correct inaccurate or incomplete data.</li>
          <li>Request deletion or restriction of your data, subject to legal exceptions.</li>
          <li>Object to certain processing, including direct marketing.</li>
          <li>Request a copy of your data in a portable format.</li>
          <li>Lodge a complaint with the Information Commissioner’s Office (ICO) if you believe we have not complied with data protection law.</li>
        </ul>
        <p>
          To exercise any of these rights, email{" "}
          <a className="text-brand-teal underline hover:text-brand-teal/80" href="mailto:privacy@cheersai.uk">
            privacy@cheersai.uk
          </a>
          .
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">8. Children’s Privacy</h2>
        <p>
          CheersAI is designed for hospitality professionals and is not directed at individuals under the age of 18. We
          do not knowingly collect personal information from children.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">9. Changes to this Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated
          revision date. Significant updates may also be communicated via email or in-app notification.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">10. Contact Us</h2>
        <address className="not-italic leading-relaxed">
          CheersAI Ltd<br />
          71-75 Shelton Street<br />
          London WC2H 9JQ<br />
          United Kingdom
          <br />
          <br />
          Email:{" "}
          <a className="text-brand-teal underline hover:text-brand-teal/80" href="mailto:privacy@cheersai.uk">
            privacy@cheersai.uk
          </a>
          <br />
          Phone:{" "}
          <a className="text-brand-teal underline hover:text-brand-teal/80" href="tel:+442045771230">
            +44 20 4577 1230
          </a>
        </address>
      </section>
    </main>
  );
}
