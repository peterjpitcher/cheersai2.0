import { Check } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LEGAL_DOCUMENTS } from '@/lib/legal/company';

/**
 * The shell of the service pages (sign in, sign up, venue set-up, password,
 * email links, no access, invitations), in the public homepage's look
 * (tasks/SPEC-service-pages-homepage-style.md): the ink band with the planner
 * grid and the orange glow, the homepage logo linking home, the page's form in
 * a white card like the hero's planner card, and a footer.
 *
 * Only white and --c-line-2 text sits on the ink band, as on the homepage: it
 * must pass 4.5:1 over the glow. Everything else is inside the card.
 */

const CONTAINER = 'mx-auto w-full max-w-[1160px] px-4 sm:px-6';

/** Inputs on these pages: 44px tall, a comfortable tap, and 16px text so a phone does not zoom in on focus. */
export const AUTH_INPUT = 'h-11 text-base';

/** A link on the white card, as the homepage writes them (--c-orange-hi is 5.2:1 on white; --c-orange is 3.5:1). */
export const AUTH_LINK = 'font-medium text-orange-hi underline underline-offset-[3px]';

/** A quieter link on the white card, such as "Back to sign in". */
export const AUTH_QUIET_LINK = 'text-ink-3 underline-offset-4 hover:text-ink hover:underline';

interface AuthCardProps {
  title: string;
  description: string;
  children: ReactNode;
  /**
   * Shown beside the card from lg (1024px), like the homepage hero's words
   * beside its planner card. Hidden below lg, where the card comes first.
   */
  aside?: ReactNode;
  /** A wider card, for a list such as the invitations. */
  wide?: boolean;
}

export function AuthCard({ title, description, children, aside, wide = false }: AuthCardProps): React.JSX.Element {
  const card = (
    <div className="rounded-[var(--r-2xl)] bg-card p-6 shadow-[var(--sh-lg)] ring-1 ring-white/10 motion-safe:animate-slide-up sm:p-8">
      <div className="space-y-2">
        <h1 className="text-balance text-2xl font-semibold leading-tight text-ink">{title}</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">{description}</p>
      </div>
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );

  return (
    <div className="relative isolate flex min-h-svh flex-col overflow-hidden bg-ink">
      <div aria-hidden="true" className="site-grid pointer-events-none absolute inset-0 -z-10" />
      {/* With a panel the card sits right, where the homepage's glow is; alone it is centred, and so is its glow. */}
      <div
        aria-hidden="true"
        className={`${aside ? 'site-glow' : 'site-glow-centre'} pointer-events-none absolute inset-0 -z-10`}
      />
      <header className={`${CONTAINER} pt-4 md:pt-5`}>
        {/* The homepage header's logo and sizes (site-header.tsx). */}
        <Link href="/" className="inline-flex rounded-[var(--r-md)]">
          <Image
            src="/brand/cheers-logo-horizontal-on-dark.png"
            alt="Cheers home"
            width={1600}
            height={547}
            sizes="(min-width: 768px) 211px, 164px"
            priority
            className="h-14 w-auto md:h-[72px]"
          />
        </Link>
      </header>
      <main id="main" className={`${CONTAINER} flex flex-1 items-center py-8 sm:py-12`}>
        {aside ? (
          // grid-cols-1 is minmax(0, 1fr), so a long word in the card cannot widen the page on a phone.
          <div className="grid w-full grid-cols-1 items-center gap-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="hidden lg:block">{aside}</div>
            <div className="mx-auto w-full max-w-[440px] lg:mr-0">{card}</div>
          </div>
        ) : (
          <div className={`mx-auto w-full ${wide ? 'max-w-[560px]' : 'max-w-[440px]'}`}>{card}</div>
        )}
      </main>
      <AuthFooter />
    </div>
  );
}

/** The site footer's link style, 44px tall so each is a comfortable tap. */
const FOOTER_LINK =
  'inline-flex min-h-11 items-center text-[var(--c-line-2)] underline-offset-4 transition-colors hover:text-white hover:underline';

function AuthFooter(): React.JSX.Element {
  const { terms, privacy } = LEGAL_DOCUMENTS;
  const links = [
    { href: terms.path, label: terms.title },
    { href: privacy.path, label: privacy.title },
    { href: '/help', label: 'Help' },
  ];
  return (
    <footer className={`${CONTAINER} pb-4`}>
      <nav aria-label="Legal and help">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 text-sm">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={FOOTER_LINK}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}

interface AuthAsideProps {
  eyebrow: string;
  title: string;
  /** The heading's second line, in orange, as the homepage hero's. */
  accent?: string;
  intro: string;
  /** A short list title, such as "What you need"; the points need none when they speak for themselves. */
  pointsTitle?: string;
  points: readonly string[];
  /** Small print under the points. */
  note?: string;
}

/**
 * The panel beside the card from lg, drawn like the homepage hero. It is not a
 * heading: the card's title is the page's one h1.
 */
export function AuthAside({ eyebrow, title, accent, intro, pointsTitle, points, note }: AuthAsideProps): React.JSX.Element {
  return (
    <div className="max-w-[540px] motion-safe:animate-slide-up">
      <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-orange">{eyebrow}</p>
      <p className="mt-5 text-balance text-4xl font-semibold leading-[1.08] text-white xl:text-5xl">
        {title}
        {accent ? <span className="block text-orange">{accent}</span> : null}
      </p>
      <p className="mt-6 text-lg leading-relaxed text-[var(--c-line-2)]">{intro}</p>
      {pointsTitle ? <p className="mt-8 text-sm font-semibold text-white">{pointsTitle}</p> : null}
      <ul className={`${pointsTitle ? 'mt-3' : 'mt-8'} space-y-3 text-[15px] leading-relaxed text-[var(--c-line-2)]`}>
        {points.map((point) => (
          <li key={point} className="flex gap-2.5">
            <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-orange" strokeWidth={2.5} />
            {point}
          </li>
        ))}
      </ul>
      {note ? <p className="mt-6 text-sm text-[var(--c-line-2)]">{note}</p> : null}
    </div>
  );
}

export function AuthMessage({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }): React.JSX.Element {
  const style =
    tone === 'error'
      ? { backgroundColor: 'var(--c-claret-soft)', color: 'var(--c-claret)' }
      : { backgroundColor: 'var(--c-status-posted-bg)', color: 'var(--c-status-posted-fg)' };
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="rounded-[var(--r-lg)] p-3 text-sm font-medium leading-relaxed"
      style={style}
    >
      {children}
    </div>
  );
}
