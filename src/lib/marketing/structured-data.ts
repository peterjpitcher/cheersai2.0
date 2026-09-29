import { guideCategory } from '@/content/guides/categories';
import type { Guide } from '@/content/guides/types';
import type { FaqItem } from '@/content/homepage';
import { plainText } from '@/content/rich-text';
import { BRAND_NAME, GUIDES_SEO, homeDescription } from '@/content/seo';
import { PLANS, SELF_SERVE_PLAN_IDS } from '@/lib/billing/plans';
import { guideImagePath, guidePath } from '@/lib/guides/guides';
import { COMPANY, CONTACT } from '@/lib/legal/company';
import { absoluteUrl } from '@/lib/marketing/site';

/**
 * schema.org JSON-LD for the public pages. Every fact comes from company.ts,
 * PLANS or the page's own content, and every value is a string, number or
 * object: never null, so nothing broken can reach search engines.
 */

export type JsonLdValue = string | number | boolean | JsonLdObject | readonly JsonLdValue[];

export interface JsonLdObject {
  readonly [key: string]: JsonLdValue;
}

const SCHEMA = 'https://schema.org';

/** The logo named in the structured data (512 x 512, in public/brand). */
export const LOGO_PATH = '/brand/cheers-icon-512.png';

function homeUrl(): string {
  return absoluteUrl('/');
}

function organizationId(): string {
  return `${homeUrl()}#organization`;
}

export function organizationJsonLd(): JsonLdObject {
  return {
    '@type': 'Organization',
    '@id': organizationId(),
    name: COMPANY.legalName,
    legalName: COMPANY.legalName,
    alternateName: COMPANY.tradingName,
    url: homeUrl(),
    logo: absoluteUrl(LOGO_PATH),
    email: CONTACT.email,
    vatID: COMPANY.vatNumber,
    identifier: {
      '@type': 'PropertyValue',
      propertyID: 'Companies House company number',
      value: COMPANY.companyNumber,
    },
    address: COMPANY.registeredOffice,
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: CONTACT.email },
  };
}

export function websiteJsonLd(): JsonLdObject {
  return {
    '@type': 'WebSite',
    '@id': `${homeUrl()}#website`,
    url: homeUrl(),
    name: COMPANY.tradingName,
    alternateName: BRAND_NAME,
    inLanguage: 'en-GB',
    publisher: { '@id': organizationId() },
  };
}

function pounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

/** One offer per plan and billing period that Checkout sells, priced ex VAT from PLANS. */
export function planOffers(): JsonLdObject[] {
  return SELF_SERVE_PLAN_IDS.flatMap((id) => {
    const plan = PLANS[id];
    const periods = [
      { pence: plan.monthlyPricePence, label: 'paid monthly', unitCode: 'MON' },
      { pence: plan.annualPricePence, label: 'paid yearly', unitCode: 'ANN' },
    ];
    return periods.flatMap(({ pence, label, unitCode }) =>
      pence === null
        ? []
        : [
            {
              '@type': 'Offer',
              name: `${plan.name}, ${label}`,
              price: pounds(pence),
              priceCurrency: 'GBP',
              url: absoluteUrl('/#pricing'),
              priceSpecification: {
                '@type': 'UnitPriceSpecification',
                price: pounds(pence),
                priceCurrency: 'GBP',
                valueAddedTaxIncluded: false,
                referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode },
              },
            },
          ],
    );
  });
}

/**
 * What Cheers is and what it costs, for search engines and AI assistants
 * reading the homepage. It can never earn Google's software app rich result,
 * which needs aggregateRating or review, because we never add ratings or
 * reviews (no invented praise). The Rich Results Test calling it ineligible
 * is expected, not a fault to fix (SPEC-homepage-and-guides §4).
 */
export function softwareApplicationJsonLd(): JsonLdObject {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${homeUrl()}#software`,
    name: COMPANY.tradingName,
    url: homeUrl(),
    description: homeDescription(),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web browser',
    inLanguage: 'en-GB',
    publisher: { '@id': organizationId() },
    offers: planOffers(),
  };
}

/** The FAQs exactly as the page shows them: links and bold text become their plain words. */
export function faqPageJsonLd(items: readonly FaqItem[]): JsonLdObject {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: plainText(item.answer) },
    })),
  };
}

/** Everything the homepage describes, as one graph. */
export function homeJsonLd(faq: readonly FaqItem[]): JsonLdObject {
  return {
    '@context': SCHEMA,
    '@graph': [organizationJsonLd(), websiteJsonLd(), softwareApplicationJsonLd(), faqPageJsonLd(faq)],
  };
}

export interface Crumb {
  readonly name: string;
  readonly path: string;
}

export function breadcrumbJsonLd(crumbs: readonly Crumb[]): JsonLdObject {
  return {
    '@context': SCHEMA,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** The guides in the order /guides lists them. */
export function guidesItemListJsonLd(guides: readonly Guide[]): JsonLdObject {
  return {
    '@context': SCHEMA,
    '@type': 'ItemList',
    name: GUIDES_SEO.heading,
    numberOfItems: guides.length,
    itemListElement: guides.map((guide, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: absoluteUrl(guidePath(guide.slug)),
      name: guide.title,
    })),
  };
}

export function articleJsonLd(guide: Guide): JsonLdObject {
  const url = absoluteUrl(guidePath(guide.slug));
  const organization = { '@type': 'Organization', name: COMPANY.legalName, url: homeUrl() };
  return {
    '@context': SCHEMA,
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: guide.title,
    description: guide.description,
    url,
    mainEntityOfPage: url,
    image: absoluteUrl(guideImagePath(guide.slug)),
    datePublished: guide.published,
    dateModified: guide.updated,
    inLanguage: 'en-GB',
    articleSection: guideCategory(guide.category).label,
    keywords: [guide.primaryKeyword, ...guide.secondaryKeywords].join(', '),
    wordCount: guide.wordCount,
    author: organization,
    publisher: { ...organization, logo: { '@type': 'ImageObject', url: absoluteUrl(LOGO_PATH) } },
  };
}

/**
 * JSON for a <script type="application/ld+json"> tag. "<", ">" and "&" become
 * \u escapes, so no text in the data can close the script tag early; the JSON
 * still parses to exactly the same values.
 */
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data).replace(/[<>&]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
