import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { listGuides } from '@/content/guides';
import { GuidesIndexPage } from '@/features/guides/guides-index-page';
import { guidesVisible } from '@/lib/guides/guides';
import { guidesIndexMetadata } from '@/lib/marketing/metadata';
import { frontDoorCta, indexable } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * `/guides` (SPEC-homepage-and-guides §3): every guide, grouped by category.
 * Not found while there are no guides. Rendered per request because the call
 * to action follows the sign-up switch.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  // With no guides the page is only a 404: it keeps the site-wide noindex.
  if (!guidesVisible(listGuides())) return {};
  return indexable(guidesIndexMetadata());
}

export default async function GuidesPage(): Promise<React.JSX.Element> {
  const guides = listGuides();
  if (!guidesVisible(guides)) notFound();
  return <GuidesIndexPage guides={guides} cta={frontDoorCta(await getSelfServeSignupSwitch())} />;
}
