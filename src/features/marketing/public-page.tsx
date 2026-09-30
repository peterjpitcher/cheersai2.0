import { Suspense, type ReactNode } from 'react';

import { listGuides } from '@/content/guides';
import { SiteFooter } from '@/features/marketing/site-footer';
import { SiteHeader } from '@/features/marketing/site-header';
import { GUIDES_PATH, guidesVisible } from '@/lib/guides/guides';
import { frontDoorCta } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

const CONTAINER = 'mx-auto w-full max-w-[1160px] px-4 sm:px-6';

interface PublicPageProps {
  /** The orange line above the title: a label, or a link back up (the Help Centre). */
  eyebrow: ReactNode;
  title: string;
  /** Lines under the title on the ink band, such as a legal page's date and version. */
  intro?: ReactNode;
  children: ReactNode;
}

/**
 * The homepage's header, ink title band and footer around a public page that
 * is not a marketing page: the legal pages and the Help Centre
 * (tasks/SPEC-service-pages-homepage-style.md). The title band is the guides
 * index's hero.
 *
 * The header's call to action follows the sign-up switch like the homepage's,
 * but in its own Suspense boundary: until the switch is read the header shows
 * without the button, so the page itself never waits on the read (the Help
 * Centre must not, and the switch read can take up to 3 seconds to time out).
 */
export function PublicPage({ eyebrow, title, intro, children }: PublicPageProps): React.JSX.Element {
  const guidesHref = guidesVisible(listGuides()) ? GUIDES_PATH : null;
  return (
    <div className="min-h-svh bg-paper text-ink">
      <Suspense fallback={<SiteHeader cta={null} guidesHref={guidesHref} />}>
        <RequestSiteHeader guidesHref={guidesHref} />
      </Suspense>
      <main id="main">
        <section aria-labelledby="page-title" className="relative isolate overflow-hidden bg-ink">
          <div aria-hidden="true" className="site-grid pointer-events-none absolute inset-0 -z-10" />
          <div aria-hidden="true" className="site-glow pointer-events-none absolute inset-0 -z-10" />
          <div className={`${CONTAINER} pb-12 pt-8 sm:pb-16 sm:pt-12`}>
            <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-orange">{eyebrow}</p>
            <h1
              id="page-title"
              className="mt-4 max-w-[760px] text-balance text-4xl font-semibold leading-[1.08] text-white sm:text-5xl"
            >
              {title}
            </h1>
            {intro ? (
              <div className="mt-5 max-w-[640px] space-y-2 text-[var(--c-line-2)]">{intro}</div>
            ) : null}
          </div>
        </section>
        <div className={`${CONTAINER} pb-16 pt-10 sm:pb-24 sm:pt-14`}>{children}</div>
      </main>
      <SiteFooter guidesHref={guidesHref} />
    </div>
  );
}

async function RequestSiteHeader({ guidesHref }: { guidesHref: string | null }): Promise<React.JSX.Element> {
  return <SiteHeader cta={frontDoorCta(await getSelfServeSignupSwitch())} guidesHref={guidesHref} />;
}
