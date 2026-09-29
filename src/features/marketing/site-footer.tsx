import Image from 'next/image';
import Link from 'next/link';

import { whatsappUrl } from '@/content/homepage';
import { LOGIN_PATH } from '@/features/marketing/cta';
import { companyDetailsLine, CONTACT, LEGAL_DOCUMENTS } from '@/lib/legal/company';

interface SiteFooterProps {
  /** "/guides" while the guides are public; null leaves the link out entirely. */
  guidesHref: string | null;
}

interface FooterLink {
  href: string;
  label: string;
}

const FOOTER_LINK = 'text-[var(--c-line-2)] underline-offset-4 transition-colors hover:text-white hover:underline';

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }): React.JSX.Element {
  return (
    <nav aria-label={title}>
      <h2 className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-[var(--c-ink-4)]">{title}</h2>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={FOOTER_LINK}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The public site's footer: links (Guides only while the guides are public),
 * the three legal pages, the contacts, and the company details the law asks
 * for on the website (from company.ts).
 */
export function SiteFooter({ guidesHref }: SiteFooterProps): React.JSX.Element {
  const { terms, privacy, dpa } = LEGAL_DOCUMENTS;
  const cheersLinks: FooterLink[] = [
    { href: '/#how-it-works', label: 'How it works' },
    { href: '/#pricing', label: 'Pricing' },
    ...(guidesHref ? [{ href: guidesHref, label: 'Guides' }] : []),
    { href: '/help', label: 'Help' },
    { href: LOGIN_PATH, label: 'Sign in' },
  ];
  const legalLinks: FooterLink[] = [terms, privacy, dpa].map((doc) => ({ href: doc.path, label: doc.title }));

  return (
    <footer className="bg-ink text-[var(--c-ink-4)]">
      <div className="mx-auto max-w-[1160px] px-4 pb-10 pt-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <Image src="/brand/cheers-logo-horizontal-on-dark-480.png" alt="Cheers" width={117} height={40} />
            <p className="max-w-[280px] text-sm leading-relaxed">
              Social media for pubs, bars, restaurants, cafes and hotels.
            </p>
          </div>
          <FooterColumn title="Cheers" links={cheersLinks} />
          <FooterColumn title="Legal" links={legalLinks} />
          <div>
            <h2 className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-[var(--c-ink-4)]">
              Contact
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a href={`mailto:${CONTACT.email}`} className={`${FOOTER_LINK} break-all`}>
                  {CONTACT.email}
                </a>
              </li>
              <li>
                WhatsApp{' '}
                <a href={whatsappUrl()} className={FOOTER_LINK} rel="noopener noreferrer">
                  {CONTACT.whatsappDisplay}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <address className="mt-12 border-t border-white/10 pt-6 text-xs not-italic leading-relaxed">
          {companyDetailsLine()}
        </address>
      </div>
    </footer>
  );
}
