import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { listGuides } from '@/content/guides';
import type { Guide } from '@/content/guides/types';
import { GuideArticlePage } from '@/features/guides/guide-article-page';
import { findGuide, relatedGuides } from '@/lib/guides/guides';
import { guideMetadata } from '@/lib/marketing/metadata';
import {
  currentDeployment,
  frontDoorCta,
  guidesVisibility,
  indexableWhenOpen,
  SwitchUnavailableError,
} from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch, type SelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * `/guides/<slug>` (SPEC-homepage-and-guides §3): one guide. Not found for a
 * slug that is not a guide, and in production while the sign-up switch is
 * off; a server error (not "not found") when the switch cannot be read, so
 * search engines keep the page (front-door.ts). The switch is checked first,
 * so a closed site never shows which slugs exist. Shown on a Preview or local
 * dev server for copy approval.
 *
 * generateStaticParams lists every guide, which loads (and so checks) every
 * article module at build time. Pages still render per request, because the
 * switch can flip at any moment.
 */
export const dynamic = 'force-dynamic';

interface GuidePageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): { slug: string }[] {
  return listGuides().map((guide) => ({ slug: guide.slug }));
}

interface ShownGuide {
  state: SelfServeSignupSwitch;
  guide: Guide;
}

/** The guide for this request, or null when the page is not found. */
async function shownGuide(slug: string): Promise<ShownGuide | null> {
  const state = await getSelfServeSignupSwitch();
  const guides = listGuides();
  const visibility = guidesVisibility(state, guides, currentDeployment());
  if (visibility === 'unavailable') throw new SwitchUnavailableError('this guide');
  const guide = visibility === 'visible' ? findGuide(guides, slug) : undefined;
  return guide ? { state, guide } : null;
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const shown = await shownGuide((await params).slug);
  // A hidden or unknown guide is only a 404: it carries nothing new.
  if (!shown) return {};
  return indexableWhenOpen(guideMetadata(shown.guide), shown.state);
}

export default async function GuidePage({ params }: GuidePageProps): Promise<React.JSX.Element> {
  const shown = await shownGuide((await params).slug);
  if (!shown) notFound();
  return (
    <GuideArticlePage
      guide={shown.guide}
      related={relatedGuides(shown.guide, listGuides())}
      cta={frontDoorCta(shown.state)}
    />
  );
}
