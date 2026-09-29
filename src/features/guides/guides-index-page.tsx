import { GUIDE_PAGE_COPY } from '@/content/guides/page-copy';
import type { Guide } from '@/content/guides/types';
import { GUIDES_SEO } from '@/content/seo';
import { GuideCard } from '@/features/guides/guide-card';
import { Breadcrumbs, CtaBox } from '@/features/guides/guide-parts';
import { JsonLd } from '@/features/marketing/json-ld';
import { SiteFooter } from '@/features/marketing/site-footer';
import { SiteHeader } from '@/features/marketing/site-header';
import { GUIDES_PATH, guidesByCategory } from '@/lib/guides/guides';
import { breadcrumbJsonLd, guidesItemListJsonLd, type Crumb } from '@/lib/marketing/structured-data';
import type { FrontDoorCta } from '@/lib/signup/front-door';

export interface GuidesIndexPageProps {
  guides: readonly Guide[];
  cta: FrontDoorCta;
}

/**
 * /guides: every guide, grouped by category in category order. The ItemList
 * JSON-LD lists them in the same order the page shows them.
 */
export function GuidesIndexPage({ guides, cta }: GuidesIndexPageProps): React.JSX.Element {
  const groups = guidesByCategory(guides);
  const inPageOrder = groups.flatMap((group) => group.guides);
  const crumbs: Crumb[] = [
    { name: GUIDE_PAGE_COPY.home, path: '/' },
    { name: GUIDE_PAGE_COPY.guides, path: GUIDES_PATH },
  ];

  return (
    <div className="min-h-svh bg-paper text-ink">
      <SiteHeader cta={cta} guidesHref={GUIDES_PATH} />
      <main id="main">
        <JsonLd data={guidesItemListJsonLd(inPageOrder)} />
        <JsonLd data={breadcrumbJsonLd(crumbs)} />

        <section aria-labelledby="guides-title" className="relative isolate overflow-hidden bg-ink">
          <div aria-hidden="true" className="site-grid pointer-events-none absolute inset-0 -z-10" />
          <div aria-hidden="true" className="site-glow pointer-events-none absolute inset-0 -z-10" />
          <div className="mx-auto w-full max-w-[1160px] px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-orange">
              {GUIDE_PAGE_COPY.guides}
            </p>
            <h1
              id="guides-title"
              className="mt-4 max-w-[760px] text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl"
            >
              {GUIDES_SEO.heading}
            </h1>
            <p className="mt-5 max-w-[620px] text-lg leading-relaxed text-[var(--c-line-2)]">{GUIDES_SEO.intro}</p>
          </div>
        </section>

        <div className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-8 sm:px-6 sm:pb-24">
          <Breadcrumbs crumbs={crumbs} />

          <div className="mt-10 space-y-16">
            {groups.map((group) => (
              <section key={group.category.id} aria-labelledby={`category-${group.category.id}`}>
                <h2
                  id={`category-${group.category.id}`}
                  className="text-2xl font-semibold tracking-[-0.01em] text-ink sm:text-3xl"
                >
                  {group.category.label}
                </h2>
                <p className="mt-2 text-base text-ink-2">{group.category.description}</p>
                <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {group.guides.map((guide) => (
                    <li key={guide.slug} className="flex">
                      <GuideCard guide={guide} headingLevel="h3" />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-16">
            <CtaBox
              cta={cta}
              heading={GUIDE_PAGE_COPY.indexCtaHeading}
              text={GUIDE_PAGE_COPY.indexCtaText}
              headingLevel="h2"
            />
          </div>
        </div>
      </main>
      <SiteFooter guidesHref={GUIDES_PATH} />
    </div>
  );
}
