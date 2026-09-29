import Image from 'next/image';
import Link from 'next/link';

import { LOGIN_PATH, PrimaryCta } from '@/features/marketing/cta';
import type { FrontDoorCta } from '@/lib/signup/front-door';

interface SiteHeaderProps {
  cta: FrontDoorCta;
  /** "/guides" while the guides are shown; null leaves the link out entirely. */
  guidesHref: string | null;
  /**
   * Where the visitor is, so the matching link is marked for everyone: on
   * /guides the Guides link is the current page; on a guide it is the current
   * section.
   */
  current?: 'guides' | 'guide';
}

interface NavLink {
  href: string;
  label: string;
  current?: 'page' | 'true';
}

/** 44px tall, so each link is a comfortable tap on a phone. */
const NAV_LINK =
  'inline-flex min-h-11 items-center rounded-[var(--r-sm)] text-[var(--c-line-2)] underline-offset-4 transition-colors hover:text-white hover:underline';

/** The current page or section: white and underlined in orange. */
const NAV_LINK_CURRENT =
  'inline-flex min-h-11 items-center rounded-[var(--r-sm)] text-white underline decoration-orange decoration-2 underline-offset-[6px]';

/**
 * The logo: 164 by 56 CSS pixels on a phone and 211 by 72 from md, about
 * 1.4 and 1.8 times the old 117 by 40. The 1600px file and a sizes list give
 * the browser a copy sharp enough for a 3x screen (next/image offers only 1x
 * and 2x copies for a fixed-size image).
 */
const LOGO_SRC = '/brand/cheers-logo-horizontal-on-dark.png';
const LOGO_SIZES = '(min-width: 768px) 211px, 164px';

/**
 * The public site's header, on the ink band: logo, main links and the call to
 * action. On a phone it wraps into two rows (logo and button, then the links)
 * so nothing scrolls sideways at 320px; the trial button says "Free trial"
 * there so it still fits beside the logo.
 */
export function SiteHeader({ cta, guidesHref, current }: SiteHeaderProps): React.JSX.Element {
  const guidesCurrent: NavLink['current'] = current === 'guides' ? 'page' : current === 'guide' ? 'true' : undefined;
  const links: NavLink[] = [
    { href: '/#how-it-works', label: 'How it works' },
    { href: '/#pricing', label: 'Pricing' },
    ...(guidesHref ? [{ href: guidesHref, label: 'Guides', current: guidesCurrent }] : []),
    { href: LOGIN_PATH, label: 'Sign in' },
  ];

  return (
    <header className="bg-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--r-md)] focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-1 pt-4 sm:px-6 md:gap-x-6 md:pb-5 md:pt-5">
        <Link href="/" className="shrink-0 rounded-[var(--r-md)]">
          <Image
            src={LOGO_SRC}
            alt="Cheers home"
            width={1600}
            height={547}
            sizes={LOGO_SIZES}
            priority
            className="h-14 w-auto md:h-[72px]"
          />
        </Link>
        <nav aria-label="Main" className="order-last w-full md:order-none md:ml-auto md:w-auto">
          <ul className="flex flex-wrap items-center gap-x-5 text-sm font-medium">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={link.current}
                  className={link.current ? NAV_LINK_CURRENT : NAV_LINK}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <PrimaryCta cta={cta} size="sm" compact />
      </div>
    </header>
  );
}
