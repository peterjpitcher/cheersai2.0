import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { listGuides } from '@/content/guides';
import type { Guide } from '@/content/guides/types';
import { GuideArticlePage } from '@/features/guides/guide-article-page';
import { findGuide, guidesVisible, relatedGuides } from '@/lib/guides/guides';
import { guideMetadata } from '@/lib/marketing/metadata';
import { frontDoorCta, indexableWhenOpen } from '@/lib/signup/front-door';
import { getSelfServeSignupSwitch, type SelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * `/guides/<slug>` (SPEC-homepage-and-guides §3): one guide. Not found while
 * the sign-up switch is off or unreadable, and for a slug that is not a guide.
 * The switch is checked first, so a closed site never shows which slugs exist.
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

function visibleGuide(state: SelfServeSignupSwitch, slug: string): Guide | undefined {
  const guides = listGuides();
  return guidesVisible(state, guides) ? findGuide(guides, slug) : undefined;
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  const state = await getSelfServeSignupSwitch();
  const guide = visibleGuide(state, slug);
  // A hidden or unknown guide is only a 404: it carries nothing new.
  if (!guide) return {};
  return indexableWhenOpen(guideMetadata(guide), state);
}

export default async function GuidePage({ params }: GuidePageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const state = await getSelfServeSignupSwitch();
  const guide = visibleGuide(state, slug);
  if (!guide) notFound();
  return <GuideArticlePage guide={guide} related={relatedGuides(guide, listGuides())} cta={frontDoorCta(state)} />;
}
