import Link from "next/link";
import type { Metadata } from "next";

const UPDATED_AT = "18 February 2026";

export const metadata: Metadata = {
  title: "Terms of Use | CheersAI",
  description:
    "Read the CheersAI terms governing access to the command centre and related services.",
  openGraph: {
    title: "Terms of Use | CheersAI",
    description:
      "Read the CheersAI terms governing access to the command centre and related services.",
    type: "article",
  },
};

export default function TermsPage() {
  return (
    <main
      className="mx-auto max-w-[720px] px-4 py-16"
      style={{ color: "var(--c-ink)" }}
    >
      <header className="space-y-4 text-center">
        <p className="eyebrow" style={{ color: "var(--c-ink-3)" }}>CheersAI</p>
        <h1
          className="text-3xl font-semibold"
          style={{ color: "var(--c-ink)" }}
        >
          Terms of Use
        </h1>
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
          Last updated: {UPDATED_AT}
        </p>
      </header>

      <section className="mt-12 space-y-6 text-base" style={{ lineHeight: "1.55" }}>
        <p>
          These terms govern use of the CheersAI command centre and related services provided by Orange Jelly Limited.
          By creating an account or using the platform, you agree to these terms.
        </p>

        <h2 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>1. Service Access</h2>
        <p>
          CheersAI provides software to plan, generate, and publish social content. Access is provided on a
          subscription basis and may be updated as the product evolves.
        </p>

        <h2 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>2. Account Responsibility</h2>
        <p>
          You are responsible for maintaining the confidentiality of your login credentials and for activity performed
          using your account. You must provide accurate account information.
        </p>

        <h2 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>3. Acceptable Use</h2>
        <p>
          You must not use CheersAI to publish unlawful, misleading, infringing, or harmful content. We may suspend
          access where misuse is identified.
        </p>

        <h2 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>4. Intellectual Property</h2>
        <p>
          CheersAI and associated branding remain the property of Orange Jelly Limited. You retain ownership of content
          and media you provide to the platform.
        </p>

        <h2 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>5. Availability and Changes</h2>
        <p>
          We aim to provide a reliable service but do not guarantee uninterrupted availability. Features, integrations,
          and limits may change over time.
        </p>

        <h2 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>6. Liability</h2>
        <p>
          To the maximum extent permitted by law, CheersAI is provided on an as-is basis and Orange Jelly Limited is
          not liable for indirect or consequential losses arising from use of the service.
        </p>

        <h2 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>7. Contact</h2>
        <p>
          Questions about these terms can be sent to{" "}
          <a
            className="hover:underline"
            style={{ color: "var(--c-orange)" }}
            href="mailto:peter@orangejelly.co.uk"
          >
            peter@orangejelly.co.uk
          </a>
          .
        </p>

        <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
          See also:{" "}
          <Link href="/privacy" className="hover:underline" style={{ color: "var(--c-orange)" }}>
            Privacy Policy
          </Link>
        </p>
      </section>
    </main>
  );
}
