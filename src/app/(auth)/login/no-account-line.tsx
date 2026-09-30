import Link from 'next/link';

import { AUTH_LINK } from '@/components/auth/auth-card';
import { SIGNUP_PATH } from '@/features/marketing/cta';
import { CONTACT } from '@/lib/legal/company';
import { frontDoorCta } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

const LINE = 'border-t border-line pt-6 text-center text-sm text-ink-2';

/**
 * The sign-in card's "Don't have an account?" line. It follows the sign-up
 * switch as the homepage's call to action does: the free trial while sign-up
 * is open, otherwise an email to us. The switch read never throws; when it
 * fails or times out (3 seconds) the line offers the email.
 */
export async function NoAccountLine(): Promise<React.JSX.Element> {
  const cta = frontDoorCta(await getSelfServeSignupSwitch());
  return (
    <p className={LINE}>
      Don&apos;t have an account?{' '}
      {cta === 'trial' ? (
        <Link href={SIGNUP_PATH} className={AUTH_LINK}>
          Start your free trial
        </Link>
      ) : (
        <a href={`mailto:${CONTACT.email}`} className={AUTH_LINK}>
          Contact support
        </a>
      )}
    </p>
  );
}

/** Holds the line's place while the switch is read, so the card does not grow when it arrives. */
export function NoAccountPlaceholder(): React.JSX.Element {
  return (
    <p aria-hidden="true" className={LINE}>
      &nbsp;
    </p>
  );
}
