import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { GUIDE_PAGE_COPY } from '@/content/guides/page-copy';
import type { GuideSectionWithId } from '@/content/guides/types';
import { PrimaryCta, SECONDARY_ON_DARK } from '@/features/marketing/cta';
import type { Crumb } from '@/lib/marketing/structured-data';
import type { FrontDoorCta } from '@/lib/signup/front-door';

/** Home / Guides / this page. The last crumb is the current page, not a link. */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }): React.JSX.Element {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-2">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.path} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-3" /> : null}
              {last ? (
                <span aria-current="page" className="truncate text-ink">
                  {crumb.name}
                </span>
              ) : (
                <Link href={crumb.path} className="underline-offset-4 hover:text-ink hover:underline">
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The table of contents: the guide's H2s, linking to their anchors. */
export function TableOfContents({ sections }: { sections: readonly GuideSectionWithId[] }): React.JSX.Element {
  return (
    <nav aria-labelledby="guide-contents-title" className="rounded-[var(--r-xl)] border border-line bg-card p-5">
      <h2
        id="guide-contents-title"
        className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-ink-2"
      >
        {GUIDE_PAGE_COPY.contents}
      </h2>
      <ol className="mt-3 space-y-0.5 border-l border-line">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-sm leading-snug text-ink-2 transition-colors hover:border-orange hover:text-ink"
            >
              {section.heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

interface CtaBoxProps {
  cta: FrontDoorCta;
  heading: string;
  text: string;
  /** The heading level, so the box fits the page's outline. */
  headingLevel: 'h2' | 'p';
}

/**
 * The call-to-action box on the guide pages: the button follows the sign-up
 * switch (free trial while it is on, "Talk to us" otherwise), with a link to
 * the homepage beside it.
 */
export function CtaBox({ cta, heading, text, headingLevel }: CtaBoxProps): React.JSX.Element {
  const Heading = headingLevel;
  return (
    <div className="relative isolate overflow-hidden rounded-[var(--r-2xl)] bg-ink p-6 sm:p-8">
      <div aria-hidden="true" className="site-glow pointer-events-none absolute inset-0 -z-10" />
      <Heading className="text-xl font-semibold leading-snug text-white sm:text-2xl">{heading}</Heading>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--c-line-2)]">{text}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <PrimaryCta cta={cta} />
        <Link href="/" className={SECONDARY_ON_DARK}>
          {GUIDE_PAGE_COPY.homeLink}
        </Link>
      </div>
    </div>
  );
}

/** The narrow version for the article's sidebar on wide screens. */
export function SideCta({ cta }: { cta: FrontDoorCta }): React.JSX.Element {
  return (
    <div className="rounded-[var(--r-xl)] border border-orange-soft bg-orange-tint p-5">
      <p className="text-base font-semibold text-ink">{GUIDE_PAGE_COPY.sideHeading}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{GUIDE_PAGE_COPY.sideText}</p>
      <div className="mt-4">
        <PrimaryCta cta={cta} size="sm" />
      </div>
    </div>
  );
}
