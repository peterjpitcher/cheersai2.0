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
    <main className="mx-auto max-w-3xl px-4 py-16 text-slate-800">
      <header className="space-y-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-teal">CheersAI</p>
        <h1 className="text-3xl font-semibold text-slate-900">Help Centre</h1>
        <p className="text-sm text-slate-500">
          Historic help article URLs now route through this support page.
        </p>
      </header>

      <section className="mt-10 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p>
          Sign in to your command centre to manage content, schedules, and settings. If you need support, contact the
          Orange Jelly team directly.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/login" className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white">
            Go to login
          </Link>
          <a
            href="mailto:peter@orangejelly.co.uk"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Email support
          </a>
        </div>
      </section>
    </main>
  );
}
