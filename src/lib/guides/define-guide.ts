import { DateTime } from 'luxon';

import { GUIDE_CATEGORIES } from '@/content/guides/categories';
import type { Guide, GuideBlock, GuideInput, GuideSectionWithId } from '@/content/guides/types';
import { isAllowedHref, linkTargets, plainText, type RichText } from '@/content/rich-text';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

/**
 * Turns what an article module writes into a Guide: checks it, gives every
 * section an anchor for the table of contents and computes the word count and
 * reading time. A broken article throws when its module loads, so the build
 * (which lists every guide for generateStaticParams) fails instead of
 * publishing it. Style checks that should not break the site (lengths, no em
 * dashes) live in the content tests instead.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Reading speed behind "N min read": a common figure for adult silent reading. */
export const WORDS_PER_MINUTE = 200;

/**
 * Ids the guide page already uses for itself: the skip link's target, the
 * contents heading and the related guides heading. A section anchor that
 * reused one would duplicate the id, so its contents link would jump to the
 * wrong place. The guide page test checks this list against the rendered page.
 */
export const RESERVED_ANCHORS: readonly string[] = ['main', 'guide-contents-title', 'related-title'];

/** A heading's anchor: "What's on this week?" becomes "whats-on-this-week". */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Every piece of text in a block, in reading order (table cells included, even empty ones). */
export function blockTexts(block: GuideBlock): RichText[] {
  switch (block.type) {
    case 'paragraph':
      return [block.text];
    case 'subheading':
      return [block.text];
    case 'list':
      return [...block.items];
    case 'tip':
      return block.title ? [block.title, block.text] : [block.text];
    case 'example':
      return block.label ? [block.label, ...block.lines] : [...block.lines];
    case 'table':
      return [block.caption, ...block.head, ...block.rows.flat()];
  }
}

/** The texts in a block that must not be empty: everything except table cells. */
function requiredTexts(block: GuideBlock): RichText[] {
  return block.type === 'table' ? [block.caption, ...block.head] : blockTexts(block);
}

/** Everything a reader reads below the title, as plain text. */
export function guideReadableText(input: GuideInput): string[] {
  return [
    input.summary,
    ...(input.intro ?? []).map(plainText),
    ...input.sections.flatMap((section) => [section.heading, ...section.blocks.flatMap(blockTexts).map(plainText)]),
    input.closing.heading,
    input.closing.text,
  ];
}

export function countWords(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + text.split(/\s+/).filter(Boolean).length, 0);
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = DateTime.fromISO(value, { zone: DEFAULT_TIMEZONE });
  return date.isValid && date.toISODate() === value;
}

/** Everything wrong with an article, in plain words; empty when it is fine. */
export function guideProblems(input: GuideInput): string[] {
  const problems: string[] = [];

  if (!SLUG_PATTERN.test(input.slug)) problems.push('the slug must be lower-case words joined by hyphens');
  const required: [string, string][] = [
    ['title', input.title],
    ['description', input.description],
    ['primary keyword', input.primaryKeyword],
    ['summary', input.summary],
    ['closing heading', input.closing.heading],
    ['closing text', input.closing.text],
  ];
  for (const [name, value] of required) {
    if (!value.trim()) problems.push(`the ${name} is empty`);
  }
  if (input.seoTitle !== undefined && !input.seoTitle.trim()) problems.push('the SEO title is empty');
  if (input.secondaryKeywords.some((keyword) => !keyword.trim())) problems.push('a secondary keyword is empty');
  if (!GUIDE_CATEGORIES.some((category) => category.id === input.category)) {
    problems.push(`the category "${input.category}" does not exist`);
  }

  const publishedOk = isRealIsoDate(input.published);
  const updatedOk = isRealIsoDate(input.updated);
  if (!publishedOk) problems.push(`the published date "${input.published}" is not a real YYYY-MM-DD date`);
  if (!updatedOk) problems.push(`the updated date "${input.updated}" is not a real YYYY-MM-DD date`);
  if (publishedOk && updatedOk && input.updated < input.published) {
    problems.push('the updated date is before the published date');
  }

  for (const paragraph of input.intro ?? []) {
    if (!plainText(paragraph).trim()) problems.push('the intro has an empty paragraph');
    for (const href of linkTargets(paragraph)) {
      if (!isAllowedHref(href)) problems.push(`the intro links to "${href}", which is not allowed`);
    }
  }

  if (!input.sections.length) problems.push('there are no sections');
  const anchors = new Set<string>();
  input.sections.forEach((section, index) => {
    const label = section.heading.trim() ? `"${section.heading}"` : `section ${index + 1}`;
    if (!section.heading.trim()) problems.push(`section ${index + 1} has no heading`);
    const anchor = section.id ?? headingId(section.heading);
    if (!SLUG_PATTERN.test(anchor)) {
      problems.push(`${label} has no usable anchor`);
    } else if (RESERVED_ANCHORS.includes(anchor)) {
      problems.push(`${label} has the anchor "${anchor}", which the page already uses`);
    } else if (anchors.has(anchor)) {
      problems.push(`two sections share the anchor "${anchor}"`);
    }
    anchors.add(anchor);
    if (!section.blocks.length) problems.push(`${label} has no content`);
    for (const block of section.blocks) {
      if (block.type === 'list' && !block.items.length) problems.push(`a list in ${label} has no items`);
      if (block.type === 'example' && !block.lines.length) problems.push(`an example in ${label} has no lines`);
      if (block.type === 'table') {
        if (!block.head.length) problems.push(`a table in ${label} has no header`);
        if (!block.rows.length) problems.push(`a table in ${label} has no rows`);
        if (block.rows.some((row) => row.length !== block.head.length)) {
          problems.push(`a table in ${label} has a row that does not match its header`);
        }
      }
      for (const text of requiredTexts(block)) {
        if (!plainText(text).trim()) problems.push(`${label} has an empty ${block.type}`);
      }
      for (const text of blockTexts(block)) {
        for (const href of linkTargets(text)) {
          if (!isAllowedHref(href)) problems.push(`${label} links to "${href}", which is not allowed`);
        }
      }
    }
  });

  return problems;
}

export function defineGuide(input: GuideInput): Guide {
  const problems = guideProblems(input);
  if (problems.length) {
    throw new Error(`Guide "${input.slug}" cannot be published: ${problems.join('; ')}.`);
  }
  const sections: GuideSectionWithId[] = input.sections.map((section) => ({
    ...section,
    id: section.id ?? headingId(section.heading),
  }));
  const wordCount = countWords(guideReadableText(input));
  return { ...input, sections, wordCount, readingMinutes: readingMinutes(wordCount) };
}
