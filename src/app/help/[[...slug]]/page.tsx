import Link from "next/link";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

interface LegacyHelpPageProps {
  params: Promise<{ slug?: string[] }>;
}

export const metadata: Metadata = {
  title: "Help | CheersAI",
  description:
    "Guidance for accessing the CheersAI command centre and contacting support.",
  alternates: {
    canonical: "/help",
  },
};

export default async function LegacyHelpPage({ params }: LegacyHelpPageProps) {
  const { slug = [] } = await params;

  if (slug.length > 0) {
    permanentRedirect("/help");
  }

  return (
    <main
      className="mx-auto max-w-[720px] px-4 py-16"
      style={{ color: "var(--c-ink)" }}
    >
      {/* Header */}
      <header className="space-y-4 text-center">
        <p
          className="eyebrow"
          style={{ color: "var(--c-ink-3)" }}
        >
          CheersAI
        </p>
        <h1
          className="text-3xl font-semibold"
          style={{ color: "var(--c-ink)" }}
        >
          Help Centre
        </h1>
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
          Historic help article URLs now route through this support page.
        </p>
      </header>

      {/* Search */}
      <div className="mt-8">
        <input
          type="search"
          placeholder="Search help topics..."
          className="w-full rounded-[var(--r-lg)] border px-4 py-3 text-sm outline-none transition"
          style={{
            borderColor: "var(--c-line)",
            backgroundColor: "var(--c-card)",
            color: "var(--c-ink)",
          }}
          disabled
          title="Search coming soon"
        />
      </div>

      {/* FAQ sections */}
      <div className="mt-10 space-y-0">
        {/* Section 1: Getting Started */}
        <details className="group">
          <summary
            className="flex cursor-pointer items-center justify-between border-b px-4 py-4 text-base font-semibold"
            style={{
              color: "var(--c-ink)",
              borderColor: "var(--c-line)",
            }}
          >
            <span>Getting Started</span>
            <svg
              className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
              style={{ color: "var(--c-ink-3)" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div
            className="px-4 py-4 text-sm leading-relaxed"
            style={{
              backgroundColor: "var(--c-paper)",
              color: "var(--c-ink-2)",
            }}
          >
            <p>
              Sign in to your command centre to manage content, schedules, and
              settings. If you need help getting started, the Orange Jelly team
              can walk you through your first post.
            </p>
            <div className="mt-4">
              <Link
                href="/login"
                className="inline-flex items-center gap-1 text-sm font-semibold hover:underline"
                style={{ color: "var(--c-orange)" }}
              >
                Go to login
              </Link>
            </div>
          </div>
        </details>

        {/* Section 2: Publishing & Scheduling */}
        <details className="group">
          <summary
            className="flex cursor-pointer items-center justify-between border-b px-4 py-4 text-base font-semibold"
            style={{
              color: "var(--c-ink)",
              borderColor: "var(--c-line)",
            }}
          >
            <span>Publishing &amp; Scheduling</span>
            <svg
              className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
              style={{ color: "var(--c-ink-3)" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div
            className="px-4 py-4 text-sm leading-relaxed"
            style={{
              backgroundColor: "var(--c-paper)",
              color: "var(--c-ink-2)",
            }}
          >
            <p>
              CheersAI lets you create content once and publish to Facebook,
              Instagram, and Google Business Profile. Use the planner to
              schedule posts ahead of time, and the publishing queue handles
              delivery automatically.
            </p>
          </div>
        </details>

        {/* Section 3: Account & Support */}
        <details className="group">
          <summary
            className="flex cursor-pointer items-center justify-between border-b px-4 py-4 text-base font-semibold"
            style={{
              color: "var(--c-ink)",
              borderColor: "var(--c-line)",
            }}
          >
            <span>Account &amp; Support</span>
            <svg
              className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
              style={{ color: "var(--c-ink-3)" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div
            className="px-4 py-4 text-sm leading-relaxed"
            style={{
              backgroundColor: "var(--c-paper)",
              color: "var(--c-ink-2)",
            }}
          >
            <p>
              If you need support, contact the Orange Jelly team directly. We
              can help with account access, connection issues, billing queries,
              and feature requests.
            </p>
            <div className="mt-4">
              <a
                href="mailto:peter@orangejelly.co.uk"
                className="inline-flex items-center gap-1 text-sm font-semibold hover:underline"
                style={{ color: "var(--c-orange)" }}
              >
                Email support
              </a>
            </div>
          </div>
        </details>
      </div>

      {/* Footer */}
      <footer className="mt-16 text-center text-xs" style={{ color: "var(--c-ink-4)" }}>
        <div className="flex items-center justify-center gap-3">
          <Link href="/terms" className="hover:underline" style={{ color: "var(--c-ink-4)" }}>
            Terms
          </Link>
          <span>&middot;</span>
          <Link href="/privacy" className="hover:underline" style={{ color: "var(--c-ink-4)" }}>
            Privacy
          </Link>
        </div>
        <p className="mt-2">CheersAI by Orange Jelly</p>
      </footer>
    </main>
  );
}
