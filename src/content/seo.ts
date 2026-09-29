import type { Guide } from '@/content/guides/types';
import { lowestMonthlyPrice } from '@/features/front-door/pricing';
import { TRIAL_DAYS } from '@/lib/billing/plans';

/**
 * Titles and descriptions for the public pages, kept in one place so the
 * keyword plan can tune them without touching the pages. The wording here is a
 * first draft. Aim for titles of 60 characters or fewer and descriptions of
 * 70 to 160 characters; the content tests check both.
 */

export const BRAND_NAME = 'Cheers by Orange Jelly';

export const HOME_SEO = {
  title: 'Social media for pubs, bars and restaurants | Cheers',
  /** The description's first sentence; homeDescription() adds the price and the trial. */
  descriptionLead:
    'Cheers writes, schedules and publishes Facebook and Instagram posts for pubs, bars and restaurants.',
  /** The title shared on Facebook, X and in messaging apps. */
  socialTitle: 'Cheers: social media for pubs, bars and restaurants',
  /** Words drawn on the share image (src/app/og/route.tsx). */
  imageEyebrow: 'For pubs, bars, restaurants, cafes and hotels',
  imageHeadline: 'Social media for pubs, bars and restaurants',
  imageAlt: 'Cheers: social media for pubs, bars, restaurants, cafes and hotels',
} as const;

/** The homepage's meta description, with the lowest price and the trial length from PLANS. */
export function homeDescription(): string {
  const price = lowestMonthlyPrice();
  const trial = `${TRIAL_DAYS}-day free trial`;
  return price
    ? `${HOME_SEO.descriptionLead} From ${price} a month ex VAT, with a ${trial}.`
    : `${HOME_SEO.descriptionLead} ${trial}.`;
}

export const GUIDES_SEO = {
  title: 'Social media guides for pubs, bars and restaurants | Cheers',
  description:
    'Practical, plain-English guides to Facebook and Instagram for pubs, bars, restaurants, cafes and hotels: what to post, when and how.',
  /** The H1 on /guides. */
  heading: 'Social media guides for hospitality',
  intro:
    'Practical advice on Facebook and Instagram for pubs, bars, restaurants, cafes and hotels, written in plain English.',
} as const;

/** A guide's page title: its own SEO title when it has one, otherwise "<title> | Cheers". */
export function guideSeoTitle(guide: Pick<Guide, 'title' | 'seoTitle'>): string {
  return guide.seoTitle ?? `${guide.title} | Cheers`;
}
