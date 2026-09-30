import Link from 'next/link';

import { getFirstPostHelpHref } from '@/lib/help/first-post';

/** A link in the Help Centre's answers (--c-orange-hi is 5.2:1 on white). */
export const HELP_LINK = 'inline-flex items-center gap-1 text-sm font-semibold text-orange-hi underline-offset-4 hover:underline';

/**
 * The Help Centre's link to the first-post article, shown only while the
 * self-serve sign-up switch is open. The page renders it inside its own
 * Suspense boundary, so the rest of the Help Centre never waits on the
 * switch read.
 */
export async function FirstPostHelpLink(): Promise<React.JSX.Element | null> {
  const href = await getFirstPostHelpHref();
  if (!href) return null;
  return (
    <Link href={href} className={HELP_LINK}>
      How to publish your first post
    </Link>
  );
}
