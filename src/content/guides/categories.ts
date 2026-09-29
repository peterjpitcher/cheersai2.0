import type { GuideCategoryId } from '@/content/guides/types';

export interface GuideCategory {
  readonly id: GuideCategoryId;
  readonly label: string;
  readonly description: string;
}

/**
 * Guide categories, in the order /guides lists them. A category with no
 * guides is not shown. They follow the keyword plan's topic groups
 * (29 September 2026).
 */
export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
  {
    id: 'planning',
    label: 'Planning and scheduling',
    description: 'What to post, when to post it and how to schedule it.',
  },
  {
    id: 'ideas',
    label: 'Ideas for your venue',
    description: 'Post ideas for pubs, restaurants, cafes, bars and hotels.',
  },
  {
    id: 'events',
    label: 'Events and seasons',
    description: 'Filling quiz nights, match days, Christmas and the rest of the year.',
  },
  {
    id: 'writing',
    label: 'Captions, hashtags and replies',
    description: 'Words that make people want to visit, and how to answer reviews.',
  },
  {
    id: 'photos',
    label: 'Photos and video',
    description: 'Pictures and Reels that show your venue at its best.',
  },
  {
    id: 'tools',
    label: 'Tools and AI',
    description: 'Scheduling tools, AI writing help and link-in-bio pages.',
  },
];

export function guideCategory(id: GuideCategoryId): GuideCategory {
  const category = GUIDE_CATEGORIES.find((entry) => entry.id === id);
  if (!category) throw new Error(`Unknown guide category: ${id}`);
  return category;
}
