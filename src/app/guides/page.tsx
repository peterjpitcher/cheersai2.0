import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { listGuides } from '@/content/guides';
import type { Guide } from '@/content/guides/types';
import { GuidesIndexPage } from '@/features/guides/guides-index-page';
import { guidesIndexMetadata } from '@/lib/marketing/metadata';
import {
  currentDeployment,
  frontDoorCta,
  guidesVisibility,
  indexableWhenOpen,
  SwitchUnavailableError,
} from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch, type SelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * `/guides` (SPEC-homepage-and-guides §3): every guide, grouped by category.
 * Not found while there are no guides, or in production while the sign-up
 * switch is off, like /help/first-post. A server error (not "not found") when
 * the switch cannot be read, so search engines keep the page (front-door.ts).
 * Shown on a Preview or local dev server for copy approval. Rendered per
 * request (one small read) so a flip of the switch shows at once.
 */
export const dynamic = 'force-dynamic';

interface ShownGuides {
  state: SelfServeSignupSwitch;
  guides: readonly Guide[];
}

/** The guides for this request, or null when the page is not found. */
async function shownGuides(): Promise<ShownGuides | null> {
  const state = await getSelfServeSignupSwitch();
  const guides = listGuides();
  const visibility = guidesVisibility(state, guides, currentDeployment());
  if (visibility === 'unavailable') throw new SwitchUnavailableError('/guides');
  return visibility === 'visible' ? { state, guides } : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const shown = await shownGuides();
  // A hidden page is only a 404: it carries nothing new and keeps the site-wide noindex.
  if (!shown) return {};
  return indexableWhenOpen(guidesIndexMetadata(), shown.state);
}

export default async function GuidesPage(): Promise<React.JSX.Element> {
  const shown = await shownGuides();
  if (!shown) notFound();
  return <GuidesIndexPage guides={shown.guides} cta={frontDoorCta(shown.state)} />;
}
