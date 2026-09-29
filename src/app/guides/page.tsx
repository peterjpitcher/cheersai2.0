import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { listGuides } from '@/content/guides';
import { GuidesIndexPage } from '@/features/guides/guides-index-page';
import { guidesVisible } from '@/lib/guides/guides';
import { guidesIndexMetadata } from '@/lib/marketing/metadata';
import { frontDoorCta, indexableWhenOpen } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * `/guides` (SPEC-homepage-and-guides §3): every guide, grouped by category.
 * Not found while the sign-up switch is off or unreadable, or while there are
 * no guides, like /help/first-post. Rendered per request (one small read) so a
 * flip of the switch shows at once.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const state = await getSelfServeSignupSwitch();
  // A hidden page is only a 404: it carries nothing new and keeps the site-wide noindex.
  if (!guidesVisible(state, listGuides())) return {};
  return indexableWhenOpen(guidesIndexMetadata(), state);
}

export default async function GuidesPage(): Promise<React.JSX.Element> {
  const state = await getSelfServeSignupSwitch();
  const guides = listGuides();
  if (!guidesVisible(state, guides)) notFound();
  return <GuidesIndexPage guides={guides} cta={frontDoorCta(state)} />;
}
