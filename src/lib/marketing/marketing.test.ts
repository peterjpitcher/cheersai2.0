import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isAllowedHref, plainText } from '@/content/rich-text';
import { lowestMonthlyPrice, yearlySavingPercent } from '@/features/front-door/pricing';
import { PLANS } from '@/lib/billing/plans';
import { titleFontSize } from '@/lib/marketing/og-image';
import { absoluteUrl, siteOrigin } from '@/lib/marketing/site';
import { planOffers, serializeJsonLd } from '@/lib/marketing/structured-data';

/** The public site's building blocks: the canonical host, JSON-LD output, prices and rich text. */

const siteUrl = vi.hoisted(() => ({ value: 'https://cheers.orangejelly.co.uk' }));

vi.mock('@/env', () => ({
  env: {
    server: {},
    client: {
      get NEXT_PUBLIC_SITE_URL() {
        return siteUrl.value;
      },
    },
  },
}));

beforeEach(() => {
  siteUrl.value = 'https://cheers.orangejelly.co.uk';
});

describe('the canonical host', () => {
  it('comes from NEXT_PUBLIC_SITE_URL, whatever path or slash it carries', () => {
    expect(siteOrigin()).toBe('https://cheers.orangejelly.co.uk');
    expect(absoluteUrl('/')).toBe('https://cheers.orangejelly.co.uk/');
    expect(absoluteUrl('/guides/a-guide')).toBe('https://cheers.orangejelly.co.uk/guides/a-guide');

    siteUrl.value = 'https://cheers.orangejelly.co.uk/';
    expect(absoluteUrl('/guides')).toBe('https://cheers.orangejelly.co.uk/guides');
    siteUrl.value = 'https://preview.example.com/some/path';
    expect(absoluteUrl('/sitemap.xml')).toBe('https://preview.example.com/sitemap.xml');
  });
});

describe('JSON-LD output', () => {
  it('cannot close its script tag early, and still parses to the same values', () => {
    const data = { name: '</script><script>alert(1)</script> & more' };
    const json = serializeJsonLd(data);
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(JSON.parse(json)).toEqual(data);
  });

  it('prices every self-serve plan from PLANS, never null and never VAT inclusive', () => {
    const offers = planOffers();
    expect(offers).toHaveLength(4);
    expect(JSON.stringify(offers)).not.toContain('null');
    expect(offers[0]).toMatchObject({
      name: `${PLANS.starter.name}, paid monthly`,
      price: ((PLANS.starter.monthlyPricePence ?? 0) / 100).toFixed(2),
      priceCurrency: 'GBP',
      priceSpecification: {
        valueAddedTaxIncluded: false,
        referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
      },
    });
    expect(offers[1]).toMatchObject({ priceSpecification: { referenceQuantity: { unitCode: 'ANN' } } });
  });
});

describe('prices shown on the homepage', () => {
  it('work out the yearly saving and the lowest monthly price from PLANS', () => {
    expect(yearlySavingPercent('starter')).toBe(10);
    expect(yearlySavingPercent('professional')).toBe(10);
    expect(yearlySavingPercent('group')).toBeNull();
    expect(lowestMonthlyPrice()).toBe('£29.99');
  });
});

describe('rich text', () => {
  it('reads as plain words, links and bold included', () => {
    expect(plainText('Just words.')).toBe('Just words.');
    expect(plainText(['Read the ', { text: 'terms', href: '/terms' }, ' and ', { strong: 'this' }, '.'])).toBe(
      'Read the terms and this.',
    );
  });

  it('allows only site paths, https and mailto links', () => {
    expect(isAllowedHref('/guides/x')).toBe(true);
    expect(isAllowedHref('https://wa.me/447990587315')).toBe(true);
    expect(isAllowedHref('mailto:peter@orangejelly.co.uk')).toBe(true);
    for (const bad of ['javascript:alert(1)', '//evil.example', 'http://example.com', 'data:x', '', 'guides/x']) {
      expect(isAllowedHref(bad), bad).toBe(false);
    }
  });
});

describe('share image titles', () => {
  it('shrink as they get longer so they fit', () => {
    expect(titleFontSize('Short title')).toBe(72);
    expect(titleFontSize('A'.repeat(50))).toBe(62);
    expect(titleFontSize('A'.repeat(80))).toBe(54);
  });
});
