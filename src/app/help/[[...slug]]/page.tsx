import { Plus } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { FirstPostHelpLink, HELP_LINK } from "@/app/help/first-post-link";
import { PublicPage } from "@/features/marketing/public-page";
import { CONTACT } from "@/lib/legal/company";

interface LegacyHelpPageProps {
  params: Promise<{ slug?: string[] }>;
}

// Rendered per request: the first-post link follows the sign-up switch, which
// must never be baked in at build time. Only that link waits on the switch
// read (its own Suspense boundary); the rest of the page does not.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Help | Cheers",
  description:
    "Guidance for accessing the Cheers command centre and contacting support.",
  alternates: {
    canonical: "/help",
  },
};

export default async function LegacyHelpPage({ params }: LegacyHelpPageProps): Promise<React.JSX.Element> {
  const { slug = [] } = await params;

  if (slug.length > 0) {
    permanentRedirect("/help");
  }

  return (
    <PublicPage
      eyebrow="Cheers by Orange Jelly"
      title="Help Centre"
      intro={<p className="text-lg leading-relaxed">Historic help article URLs now route through this support page.</p>}
    >
      <div className="max-w-[760px]">
        {/* Search */}
        <input
          type="search"
          placeholder="Search help topics..."
          className="h-12 w-full rounded-[var(--r-lg)] border border-line bg-card px-4 text-base text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
          disabled
          title="Search coming soon"
        />

        {/* FAQ sections, drawn like the homepage's questions */}
        <div className="mt-10 divide-y divide-line border-y border-line">
          <HelpSection title="Getting Started">
            <p>
              Sign in to your command centre to manage content, schedules, and
              settings. If you need help getting started, the Orange Jelly team
              can walk you through your first post.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {/* Listed only while the self-serve sign-up switch is open (src/lib/help/first-post.ts). */}
              <Suspense fallback={null}>
                <FirstPostHelpLink />
              </Suspense>
              <Link href="/login" className={HELP_LINK}>
                Go to login
              </Link>
            </div>
          </HelpSection>

          <HelpSection title="Publishing & Scheduling">
            <p>
              Cheers lets you create content once and publish to Facebook
              and Instagram. Use the planner to
              schedule posts ahead of time, and the publishing queue handles
              delivery automatically.
            </p>
          </HelpSection>

          <HelpSection title="Account & Support">
            <p>
              If you need support, contact the Orange Jelly team directly. We
              can help with account access, connection issues, billing queries,
              and feature requests.
            </p>
            <div className="mt-4">
              <a href={`mailto:${CONTACT.email}`} className={HELP_LINK}>
                Email support
              </a>
            </div>
          </HelpSection>
        </div>
      </div>
    </PublicPage>
  );
}

/** One question, opened and closed like the homepage's questions (front-door-page.tsx). */
function HelpSection({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <Plus
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-orange-hi transition-transform duration-200 group-open:rotate-45"
          strokeWidth={2}
        />
      </summary>
      <div className="pb-6 pr-9 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </details>
  );
}
