import Image from 'next/image';
import Link from 'next/link';

import { LOGIN_PATH, PrimaryCta } from '@/features/marketing/cta';
import type { FrontDoorCta } from '@/lib/signup/front-door';

interface SiteHeaderProps {
  cta: FrontDoorCta;
  /** "/guides" while the guides are public; null leaves the link out entirely. */
  guidesHref: string | null;
}

const NAV_LINK =
  'rounded-[var(--r-sm)] py-1 text-[var(--c-line-2)] underline-offset-4 transition-colors hover:text-white hover:underline';

/**
 * The public site's header, on the ink band: logo, main links and the call to
 * action. On a phone it wraps into two rows (logo and button, then the links)
 * so nothing scrolls sideways at 375px.
 */
export function SiteHeader({ cta, guidesHref }: SiteHeaderProps): React.JSX.Element {
  const links = [
    { href: '/#how-it-works', label: 'How it works' },
    { href: '/#pricing', label: 'Pricing' },
    ...(guidesHref ? [{ href: guidesHref, label: 'Guides' }] : []),
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
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6 md:py-5">
        <Link href="/" className="shrink-0 rounded-[var(--r-md)]">
          <Image
            src="/brand/cheers-logo-horizontal-on-dark-480.png"
            alt="Cheers home"
            width={117}
            height={40}
            priority
          />
        </Link>
        <nav aria-label="Main" className="order-last w-full md:order-none md:ml-auto md:w-auto">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-medium">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={NAV_LINK}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <PrimaryCta cta={cta} size="sm" />
      </div>
    </header>
  );
}
