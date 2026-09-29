import Link from 'next/link';

import { CONTACT } from '@/lib/legal/company';
import type { FrontDoorCta } from '@/lib/signup/front-door';

/**
 * The public site's call to action, which follows the sign-up switch: "Start
 * your free trial" (to /signup) only while the switch is on, otherwise "Talk
 * to us" by email.
 *
 * Colours meet WCAG 2.2 AA: ink text on --c-orange is 5.1:1, and on hover
 * white text on --c-orange-hi is 5.4:1. (White on --c-orange would be 3.5:1.)
 */

export const SIGNUP_PATH = '/signup';
export const LOGIN_PATH = '/login';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r-lg)] bg-orange font-semibold text-ink shadow-[var(--sh-sm)] transition-colors duration-150 hover:bg-orange-hi hover:text-white';

const SIZES = {
  sm: `${BASE} h-10 px-4 text-sm`,
  lg: `${BASE} h-12 px-6 text-base`,
  block: `${BASE} h-12 w-full px-6 text-base`,
} as const;

/** A secondary action on the ink background. */
export const SECONDARY_ON_DARK =
  'inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r-lg)] border border-white/25 px-6 text-base font-semibold text-white transition-colors duration-150 hover:bg-white/10';

/** A secondary action on a light background. */
export const SECONDARY_ON_LIGHT =
  'inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r-lg)] border border-line-2 bg-card px-6 text-base font-semibold text-ink transition-colors duration-150 hover:bg-paper-2';

interface PrimaryCtaProps {
  cta: FrontDoorCta;
  /** "sm" for the header, "lg" by default, "block" to fill its container. */
  size?: keyof typeof SIZES;
  /**
   * For the header: below sm the trial button reads "Free trial", so it fits
   * beside the logo on a 320px phone. "Talk to us" is short enough already.
   */
  compact?: boolean;
}

export function PrimaryCta({ cta, size = 'lg', compact = false }: PrimaryCtaProps): React.JSX.Element {
  if (cta === 'trial') {
    return (
      <Link href={SIGNUP_PATH} className={SIZES[size]}>
        {compact ? (
          <>
            <span className="sm:hidden">Free trial</span>
            <span className="hidden sm:inline">Start your free trial</span>
          </>
        ) : (
          'Start your free trial'
        )}
      </Link>
    );
  }
  return (
    <a href={`mailto:${CONTACT.email}`} className={SIZES[size]}>
      Talk to us
    </a>
  );
}
