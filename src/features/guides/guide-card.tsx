import Link from 'next/link';

import { guideCategory } from '@/content/guides/categories';
import { GUIDE_PAGE_COPY } from '@/content/guides/page-copy';
import type { Guide } from '@/content/guides/types';
import { guidePath } from '@/lib/guides/guides';
import { formatUkLongDate } from '@/lib/utils/date';

interface GuideCardProps {
  guide: Guide;
  /** The card title's heading level, so it fits the page's outline. */
  headingLevel: 'h2' | 'h3';
  /** Leave the category out where a heading above already names it. */
  showCategory?: boolean;
}

/** A guide in a list: the whole card is one link (the title's link stretches over it). */
export function GuideCard({ guide, headingLevel, showCategory = true }: GuideCardProps): React.JSX.Element {
  const Heading = headingLevel;
  return (
    <article className="relative flex w-full flex-col rounded-[var(--r-xl)] border border-line bg-card p-6 transition-shadow duration-150 hover:shadow-[var(--sh-md)]">
      {showCategory ? (
        <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-orange-hi">
          {guideCategory(guide.category).label}
        </p>
      ) : null}
      <Heading className="text-lg font-semibold leading-snug text-ink">
        <Link
          href={guidePath(guide.slug)}
          className="underline-offset-4 after:absolute after:inset-0 after:rounded-[var(--r-xl)] after:content-[''] hover:underline"
        >
          {guide.title}
        </Link>
      </Heading>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{guide.description}</p>
      <p className="mt-auto flex flex-wrap gap-x-2 pt-5 text-sm text-ink-3">
        <time dateTime={guide.updated}>
          {GUIDE_PAGE_COPY.updated} {formatUkLongDate(guide.updated)}
        </time>
        <span aria-hidden="true">&middot;</span>
        <span>{GUIDE_PAGE_COPY.readingTime(guide.readingMinutes)}</span>
      </p>
    </article>
  );
}
