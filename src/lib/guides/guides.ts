import { GUIDE_CATEGORIES, type GuideCategory } from '@/content/guides/categories';
import type { Guide, IsoDate } from '@/content/guides/types';
import type { SelfServeSignupSwitch } from '@/lib/signup/switch';

/**
 * Lookups the guide pages, the homepage, the sitemap and the share images
 * share. Everything takes the list of guides as an argument, so tests can pass
 * a fixture instead of the real (empty) list.
 */

export const GUIDES_PATH = '/guides';

export function guidePath(slug: string): string {
  return `${GUIDES_PATH}/${slug}`;
}

/** The guide's share image (src/app/og/guides/[slug]/route.tsx). */
export function guideImagePath(slug: string): string {
  return `/og/guides/${slug}`;
}

/**
 * Whether the guides are public for this request. Like everything else from
 * the sign-up work, they stay hidden (not found, and linked from nowhere) while
 * the self_serve_signup switch is off or cannot be read. With the switch on
 * they also need at least one guide, so an empty list is never shown.
 */
export function guidesVisible(state: SelfServeSignupSwitch, guides: readonly Guide[]): boolean {
  return state === 'open' && guides.length > 0;
}

export function findGuide(guides: readonly Guide[], slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}

/** Most recently updated first, then by title. */
export function byNewest(a: Guide, b: Guide): number {
  if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
  return a.title.localeCompare(b.title, 'en-GB');
}

export interface GuideGroup {
  readonly category: GuideCategory;
  readonly guides: readonly Guide[];
}

/** The guides under each category, in category order, leaving out empty categories. */
export function guidesByCategory(guides: readonly Guide[]): GuideGroup[] {
  return GUIDE_CATEGORIES.map((category) => ({
    category,
    guides: guides.filter((guide) => guide.category === category.id).sort(byNewest),
  })).filter((group) => group.guides.length > 0);
}

/** The newest guides, for the homepage. */
export function latestGuides(guides: readonly Guide[], limit = 3): Guide[] {
  return [...guides].sort(byNewest).slice(0, limit);
}

/**
 * Guides to suggest after an article: the ones it names first, then others in
 * the same category, then the rest, newest first, never the article itself.
 */
export function relatedGuides(guide: Guide, guides: readonly Guide[], limit = 3): Guide[] {
  const others = guides.filter((other) => other.slug !== guide.slug);
  const named = (guide.related ?? [])
    .map((slug) => others.find((other) => other.slug === slug))
    .filter((other): other is Guide => other !== undefined);
  const sameCategory = others.filter((other) => other.category === guide.category).sort(byNewest);
  const rest = others.filter((other) => other.category !== guide.category).sort(byNewest);

  const chosen: Guide[] = [];
  for (const candidate of [...named, ...sameCategory, ...rest]) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(candidate)) chosen.push(candidate);
  }
  return chosen;
}

/** The most recent update across the guides, or null when there are none. */
export function lastUpdated(guides: readonly Guide[]): IsoDate | null {
  return guides.reduce<IsoDate | null>(
    (latest, guide) => (latest === null || guide.updated > latest ? guide.updated : latest),
    null,
  );
}
