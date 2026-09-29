import { guideCategory } from '@/content/guides/categories';
import { GUIDE_PAGE_COPY } from '@/content/guides/page-copy';
import type { Guide } from '@/content/guides/types';
import { GuideBody } from '@/features/guides/guide-body';
import { GuideCard } from '@/features/guides/guide-card';
import { Breadcrumbs, CtaBox, SideCta, TableOfContents } from '@/features/guides/guide-parts';
import { JsonLd } from '@/features/marketing/json-ld';
import { SiteFooter } from '@/features/marketing/site-footer';
import { SiteHeader } from '@/features/marketing/site-header';
import { GUIDES_PATH, guidePath } from '@/lib/guides/guides';
import { articleJsonLd, breadcrumbJsonLd, type Crumb } from '@/lib/marketing/structured-data';
import type { FrontDoorCta } from '@/lib/signup/front-door';
import { formatUkLongDate } from '@/lib/utils/date';

export interface GuideArticlePageProps {
  guide: Guide;
  related: readonly Guide[];
  cta: FrontDoorCta;
}

/**
 * One guide at /guides/<slug>: breadcrumbs, the title and standfirst, the
 * last-updated date in London time, a table of contents from the H2s, the
 * body, a closing call to action that follows the sign-up switch and related
 * guides. Article and BreadcrumbList JSON-LD describe the same page.
 */
export function GuideArticlePage({ guide, related, cta }: GuideArticlePageProps): React.JSX.Element {
  const crumbs: Crumb[] = [
    { name: GUIDE_PAGE_COPY.home, path: '/' },
    { name: GUIDE_PAGE_COPY.guides, path: GUIDES_PATH },
    { name: guide.title, path: guidePath(guide.slug) },
  ];

  return (
    <div className="min-h-svh bg-paper text-ink">
      <SiteHeader cta={cta} guidesHref={GUIDES_PATH} current="guide" />
      <main id="main">
        <JsonLd data={articleJsonLd(guide)} />
        <JsonLd data={breadcrumbJsonLd(crumbs)} />

        <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-12">
          <Breadcrumbs crumbs={crumbs} />

          <article className="mt-8">
            <header className="max-w-[760px]">
              <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-orange-hi">
                {guideCategory(guide.category).label}
              </p>
              <h1 className="mt-3 text-balance text-4xl font-semibold leading-[1.1] text-ink sm:text-5xl">
                {guide.title}
              </h1>
              <p className="mt-5 text-xl leading-relaxed text-ink-2">{guide.summary}</p>
              <p className="mt-6 flex flex-wrap gap-x-2 text-sm text-ink-3">
                <time dateTime={guide.updated}>
                  {GUIDE_PAGE_COPY.updated} {formatUkLongDate(guide.updated)}
                </time>
                <span aria-hidden="true">&middot;</span>
                <span>{GUIDE_PAGE_COPY.readingTime(guide.readingMinutes)}</span>
              </p>
            </header>

            <div className="mt-10 grid grid-cols-1 gap-10 border-t border-line pt-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-16">
              {/*
                The sidebar comes first so the contents sit above the article on a phone. On wide
                screens the call to action scrolls away with the page and only the contents stay in
                view, capped to the screen's height (scrolling inside if needed) so every entry can
                be reached however long the guide. A plain div, not an aside: an aside inside the
                article is a nested landmark, and the contents are already a labelled nav.
              */}
              <div className="lg:col-start-2 lg:row-start-1">
                <div className="mb-6 hidden lg:block">
                  <SideCta cta={cta} />
                </div>
                <div className="lg:sticky lg:top-8 lg:max-h-[calc(100svh-4rem)] lg:overflow-y-auto">
                  <TableOfContents sections={guide.sections} />
                </div>
              </div>

              <div className="min-w-0 max-w-[700px] lg:col-start-1 lg:row-start-1">
                <GuideBody guide={guide} />
                <div className="mt-14">
                  <CtaBox cta={cta} heading={guide.closing.heading} text={guide.closing.text} headingLevel="h2" />
                </div>
              </div>
            </div>
          </article>
        </div>

        {related.length ? (
          <section aria-labelledby="related-title" className="border-t border-line bg-card py-16 sm:py-20">
            <div className="mx-auto w-full max-w-[1160px] px-4 sm:px-6">
              <h2 id="related-title" className="text-2xl font-semibold text-ink sm:text-3xl">
                {GUIDE_PAGE_COPY.related}
              </h2>
              <ul className="mt-8 grid gap-4 md:grid-cols-3">
                {related.map((other) => (
                  <li key={other.slug} className="flex">
                    <GuideCard guide={other} headingLevel="h3" />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter guidesHref={GUIDES_PATH} />
    </div>
  );
}
