import type { GuideCategoryId } from '@/content/guides/types';

export interface GuideCategory {
  readonly id: GuideCategoryId;
  readonly label: string;
  readonly description: string;
}

/**
 * Guide categories, in the order /guides lists them. A category with no
 * guides is not shown. The keyword plan may rename or reorder these.
 */
export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
  {
    id: 'getting-started',
    label: 'Getting started',
    description: 'Setting up Facebook and Instagram for your venue.',
  },
  {
    id: 'planning',
    label: 'Planning your posts',
    description: 'What to post, how often and when.',
  },
  {
    id: 'writing',
    label: 'Writing posts',
    description: 'Captions, tone of voice and giving people a reason to visit.',
  },
  {
    id: 'photos',
    label: 'Photos and video',
    description: 'Pictures and clips that show your venue at its best.',
  },
  {
    id: 'events',
    label: 'Events and busy days',
    description: 'Filling quiz nights, match days, bank holidays and Christmas.',
  },
];

export function guideCategory(id: GuideCategoryId): GuideCategory {
  const category = GUIDE_CATEGORIES.find((entry) => entry.id === id);
  if (!category) throw new Error(`Unknown guide category: ${id}`);
  return category;
}
