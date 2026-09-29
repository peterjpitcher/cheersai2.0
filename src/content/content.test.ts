import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { bannedClaimsIn } from '@/content/claims';
import { listGuides } from '@/content/guides';
import { GUIDE_PAGE_COPY } from '@/content/guides/page-copy';
import type { Guide, GuideBlock } from '@/content/guides/types';
import { linkTargets, plainText, type RichText } from '@/content/rich-text';
import { GUIDES_SEO, guideSeoTitle, HOME_SEO, homeDescription } from '@/content/seo';
import { guideProblems } from '@/lib/guides/define-guide';
import { LEGAL_DOCUMENTS } from '@/lib/legal/company';

import { SAMPLE_GUIDES } from '../../tests/fixtures/guides/sample-guides';

/**
 * Content rules for the public site (SPEC-homepage-and-guides): no em dashes
 * anywhere in the copy or the code that renders it, search titles and
 * descriptions within length, no banned claims about Cheers (claims.ts), and
 * every guide (the published list and the test fixtures) well formed, with
 * links that go somewhere real.
 */

const ROOT = process.cwd();

/** The homepage copy and constants, the guide modules, and everything that renders them. */
const SCANNED = [
  'src/content',
  'src/features/front-door',
  'src/features/marketing',
  'src/features/guides',
  'src/lib/marketing',
  'src/lib/guides',
  'src/lib/design',
  'src/app/guides',
  'src/app/og',
  'src/app/page.tsx',
  'src/app/sitemap.ts',
  'tests/fixtures/guides',
];

function filesUnder(path: string): string[] {
  const absolute = join(ROOT, path);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const EM_DASH = String.fromCharCode(0x2014);

/** Pages a guide may link to besides other guides. */
const SITE_PATHS = new Set(['/', '/signup', '/login', '/help', '/guides', ...Object.values(LEGAL_DOCUMENTS).map((doc) => doc.path)]);

function blockTexts(block: GuideBlock): RichText[] {
  switch (block.type) {
    case 'paragraph':
    case 'subheading':
      return [block.text];
    case 'list':
      return [...block.items];
    case 'tip':
      return block.title ? [block.title, block.text] : [block.text];
  }
}

function guideLinks(guide: Guide): string[] {
  return guide.sections.flatMap((section) => section.blocks.flatMap(blockTexts).flatMap(linkTargets));
}

/** Every rule a guide must meet, given the other guides it may link to. */
function guideRuleBreaks(guide: Guide, all: readonly Guide[]): string[] {
  const slugs = new Set(all.map((other) => other.slug));
  const breaks = guideProblems(guide).map((problem) => `${guide.slug}: ${problem}`);
  const title = guideSeoTitle(guide);
  if (title.length > 60) breaks.push(`${guide.slug}: the page title is ${title.length} characters (60 at most)`);
  if (guide.description.length < 70 || guide.description.length > 160) {
    breaks.push(`${guide.slug}: the description is ${guide.description.length} characters (70 to 160)`);
  }
  for (const slug of guide.related ?? []) {
    if (!slugs.has(slug) || slug === guide.slug) breaks.push(`${guide.slug}: related guide "${slug}" does not exist`);
  }
  for (const href of guideLinks(guide)) {
    if (!href.startsWith('/')) continue;
    const path = href.split('#')[0] || '/';
    const guideSlug = path.startsWith('/guides/') ? path.slice('/guides/'.length) : null;
    if (guideSlug !== null ? !slugs.has(guideSlug) : !SITE_PATHS.has(path)) {
      breaks.push(`${guide.slug}: links to ${href}, which is not a page`);
    }
  }
  const words = [guide.title, guide.description, guide.summary, ...guide.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(blockTexts).map(plainText)])];
  if (words.some((text) => text.includes(EM_DASH))) breaks.push(`${guide.slug}: contains an em dash`);
  // The closing sells Cheers, so it must not promise what new venues do not get.
  const claims = bannedClaimsIn(`${guide.closing.heading} ${guide.closing.text}`);
  if (claims.length) breaks.push(`${guide.slug}: the closing mentions ${claims.join(', ')}`);
  return breaks;
}

/** Every fixed word on the guide pages, the search titles and descriptions, and the share image words. */
function siteClaimTexts(): string[] {
  const pageCopy = Object.values(GUIDE_PAGE_COPY).map((value) => (typeof value === 'function' ? value(5) : value));
  return [...pageCopy, ...Object.values(HOME_SEO), homeDescription(), ...Object.values(GUIDES_SEO)];
}

describe('the public site copy and code', () => {
  it('never contains an em dash', () => {
    const files = SCANNED.flatMap(filesUnder);
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(EM_DASH)).map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('never claims what new venues do not get, in the fixed guide words, search text or share images', () => {
    const texts = siteClaimTexts();
    expect(texts.length).toBeGreaterThan(15);
    expect(texts.flatMap((text) => bannedClaimsIn(text).map((claim) => `${claim}: ${text}`))).toEqual([]);
  });

  it('catches the claims it bans', () => {
    expect(bannedClaimsIn('Cheers can boost this as an ad.')).toEqual(['paid ads']);
    expect(bannedClaimsIn('Send it to TikTok and LinkedIn too.')).toEqual(['TikTok', 'LinkedIn']);
    expect(bannedClaimsIn('Post to X or Twitter.')).toEqual(['Twitter or X']);
    expect(bannedClaimsIn('Import your events from the management app.')).toEqual(['the management app or its import']);
    expect(bannedClaimsIn('Show up on your Business Profile.')).toEqual(['Google or a Business Profile']);
    expect(bannedClaimsIn('Run a tournament campaign.')).toEqual(['campaigns', 'tournaments']);
    expect(bannedClaimsIn("An important note for your pub's Facebook Page and Instagram.")).toEqual([]);
  });

  it('keeps search titles within 60 characters and descriptions within 70 to 160', () => {
    for (const title of [HOME_SEO.title, GUIDES_SEO.title]) expect(title.length, title).toBeLessThanOrEqual(60);
    for (const description of [homeDescription(), GUIDES_SEO.description]) {
      expect(description.length, description).toBeGreaterThanOrEqual(70);
      expect(description.length, description).toBeLessThanOrEqual(160);
    }
  });
});

describe('the guides', () => {
  it('every published guide meets the rules and has a unique slug', () => {
    const published = listGuides();
    expect(new Set(published.map((guide) => guide.slug)).size).toBe(published.length);
    expect(published.flatMap((guide) => guideRuleBreaks(guide, published))).toEqual([]);
  });

  it('the test fixtures meet the same rules, so the checks themselves are exercised', () => {
    expect(SAMPLE_GUIDES.flatMap((guide) => guideRuleBreaks(guide, SAMPLE_GUIDES))).toEqual([]);
  });

  it('the rules catch a guide that breaks them', () => {
    const [first] = SAMPLE_GUIDES;
    const broken: Guide = {
      ...first,
      seoTitle: 'A search title that runs on for far longer than sixty characters in total',
      description: 'Too short.',
      related: ['missing-guide'],
      sections: [
        {
          id: 'links',
          heading: 'Links',
          blocks: [{ type: 'paragraph', text: [{ text: 'gone', href: '/guides/missing-guide' }, { text: 'x', href: '/nowhere' }] }],
        },
        { id: 'dash', heading: `A heading ${EM_DASH} with a dash`, blocks: [{ type: 'paragraph', text: 'Words.' }] },
      ],
      closing: { heading: 'Boost it', text: 'Cheers can turn this into an ad and post it to TikTok.' },
    };
    const breaks = guideRuleBreaks(broken, [broken]).map((line) => line.replace(`${first.slug}: `, ''));
    expect(breaks).toEqual([
      'the page title is 73 characters (60 at most)',
      'the description is 10 characters (70 to 160)',
      'related guide "missing-guide" does not exist',
      'links to /guides/missing-guide, which is not a page',
      'links to /nowhere, which is not a page',
      'contains an em dash',
      'the closing mentions paid ads, TikTok',
    ]);
  });
});
