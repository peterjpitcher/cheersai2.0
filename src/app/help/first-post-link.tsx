import Link from 'next/link';

import { getFirstPostHelpHref } from '@/lib/help/first-post';

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
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      style={{ color: 'var(--c-orange)' }}
    >
      How to publish your first post
    </Link>
  );
}
