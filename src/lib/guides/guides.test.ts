import { describe, expect, it } from 'vitest';

import type { GuideBlock, GuideInput } from '@/content/guides/types';
import {
  countWords,
  defineGuide,
  guideProblems,
  guideReadableText,
  headingId,
  readingMinutes,
  RESERVED_ANCHORS,
  WORDS_PER_MINUTE,
} from '@/lib/guides/define-guide';
import {
  findGuide,
  guideImagePath,
  guidePath,
  guidesByCategory,
  lastUpdated,
  latestGuides,
  relatedGuides,
} from '@/lib/guides/guides';

import { planningGuide, SAMPLE_GUIDES, storiesGuide } from '../../../tests/fixtures/guides/sample-guides';

/** The guide format: checks, anchors, reading time, and the lookups the pages share. */

function input(overrides: Partial<GuideInput> = {}): GuideInput {
  return {
    slug: 'a-test-guide',
    title: 'A test guide',
    description: 'A description long enough to be a real meta description for a test guide page.',
    primaryKeyword: 'test guide',
    secondaryKeywords: [],
    category: 'writing',
    published: '2026-09-01',
    updated: '2026-09-02',
    summary: 'What the reader gets.',
    sections: [{ heading: 'First part', blocks: [{ type: 'paragraph', text: 'Some words here.' }] }],
    closing: { heading: 'Try it', text: 'Try Cheers.' },
    ...overrides,
  };
}

describe('defineGuide', () => {
  it('gives each section an anchor made from its heading, keeping any it was given', () => {
    const guide = defineGuide(
      input({
        sections: [
          { heading: "What's on this week?", blocks: [{ type: 'paragraph', text: 'One.' }] },
          { heading: 'Food & drink', id: 'food', blocks: [{ type: 'paragraph', text: 'Two.' }] },
        ],
      }),
    );
    expect(guide.sections.map((section) => section.id)).toEqual(['whats-on-this-week', 'food']);
  });

  it('counts the words a reader reads and works out the reading time from them', () => {
    const words = countWords(guideReadableText(planningGuide));
    expect(planningGuide.wordCount).toBe(words);
    expect(planningGuide.readingMinutes).toBe(Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)));
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(WORDS_PER_MINUTE)).toBe(1);
    expect(readingMinutes(WORDS_PER_MINUTE + 1)).toBe(2);
  });

  it('counts link and bold words as plain words', () => {
    const guide = defineGuide(
      input({
        summary: 'One two.',
        sections: [
          {
            heading: 'Three',
            blocks: [{ type: 'paragraph', text: ['Four ', { strong: 'five' }, ' ', { text: 'six seven', href: '/guides' }] }],
          },
        ],
        closing: { heading: 'Eight', text: 'Nine ten.' },
      }),
    );
    expect(guide.wordCount).toBe(10);
  });

  it('refuses an article with problems, naming them', () => {
    expect(() =>
      defineGuide(input({ slug: 'Not A Slug', published: '2026-02-30', updated: '2026-09-02' })),
    ).toThrowError(/cannot be published: the slug must be lower-case words joined by hyphens; the published date "2026-02-30" is not a real YYYY-MM-DD date/);
  });

  it('finds every kind of problem', () => {
    expect(guideProblems(input())).toEqual([]);
    expect(guideProblems(input({ updated: '2026-08-01' }))).toContain('the updated date is before the published date');
    expect(guideProblems(input({ published: '1 September 2026' as GuideInput['published'] }))).toContain(
      'the published date "1 September 2026" is not a real YYYY-MM-DD date',
    );
    expect(guideProblems(input({ title: ' ' }))).toContain('the title is empty');
    expect(guideProblems(input({ seoTitle: '' }))).toContain('the SEO title is empty');
    expect(guideProblems(input({ secondaryKeywords: [''] }))).toContain('a secondary keyword is empty');
    expect(guideProblems(input({ category: 'nope' as GuideInput['category'] }))).toContain(
      'the category "nope" does not exist',
    );
    expect(guideProblems(input({ sections: [] }))).toContain('there are no sections');
    expect(
      guideProblems(
        input({
          sections: [
            { heading: 'Same', blocks: [{ type: 'paragraph', text: 'a' }] },
            { heading: 'Same', blocks: [{ type: 'list', style: 'bullets', items: [] }] },
            { heading: '!!!', blocks: [] },
          ],
        }),
      ),
    ).toEqual([
      'two sections share the anchor "same"',
      'a list in "Same" has no items',
      '"!!!" has no usable anchor',
      '"!!!" has no content',
    ]);
  });

  it('refuses a section anchor the page already uses for itself', () => {
    const paragraph = { type: 'paragraph', text: 'Words.' } as const;
    expect(guideProblems(input({ sections: [{ heading: 'Main', blocks: [paragraph] }] }))).toEqual([
      '"Main" has the anchor "main", which the page already uses',
    ]);
    for (const id of RESERVED_ANCHORS) {
      expect(guideProblems(input({ sections: [{ heading: 'Anything', id, blocks: [paragraph] }] })), id).toEqual([
        `"Anything" has the anchor "${id}", which the page already uses`,
      ]);
    }
  });

  it('refuses links that are not a site path, https or mailto', () => {
    for (const href of ['javascript:alert(1)', '//evil.example', 'http://example.com', 'data:text/html,hi', '/\\evil']) {
      const problems = guideProblems(
        input({ sections: [{ heading: 'Links', blocks: [{ type: 'paragraph', text: [{ text: 'x', href }] }] }] }),
      );
      expect(problems, href).toContain(`"Links" links to "${href}", which is not allowed`);
    }
    for (const href of ['/guides/other', '/#pricing', 'https://www.example.com/page', 'mailto:someone@example.com']) {
      const problems = guideProblems(
        input({ sections: [{ heading: 'Links', blocks: [{ type: 'tip', text: [{ text: 'x', href }] }] }] }),
      );
      expect(problems, href).toEqual([]);
    }
  });

  it('checks examples and tables, and allows empty table cells', () => {
    type TableBlock = Extract<GuideBlock, { type: 'table' }>;
    const table = (overrides: Partial<TableBlock> = {}): TableBlock => ({
      type: 'table',
      caption: 'A week',
      head: ['Day', 'Post'],
      rows: [['Monday', '']],
      ...overrides,
    });
    const problems = (...blocks: GuideBlock[]): string[] =>
      guideProblems(input({ sections: [{ heading: 'Plan', blocks }] }));

    expect(problems(table())).toEqual([]);
    expect(problems(table({ rows: [['Monday']] }))).toContain('a table in "Plan" has a row that does not match its header');
    expect(problems(table({ rows: [] }))).toContain('a table in "Plan" has no rows');
    expect(problems(table({ head: [], rows: [[]] }))).toContain('a table in "Plan" has no header');
    expect(problems(table({ caption: ' ' }))).toContain('"Plan" has an empty table');
    expect(problems(table({ rows: [['Monday', [{ text: 'x', href: 'javascript:alert(1)' }]]] }))).toContain(
      '"Plan" links to "javascript:alert(1)", which is not allowed',
    );
    expect(problems({ type: 'example', lines: [] })).toContain('an example in "Plan" has no lines');
    expect(problems({ type: 'example', label: 'Prompt', lines: [' '] })).toContain('"Plan" has an empty example');
    expect(problems({ type: 'example', label: 'Prompt', lines: ['Write a post.'] })).toEqual([]);
  });

  it('checks the intro and counts its words, the table and the example with the rest', () => {
    expect(guideProblems(input({ intro: [' '] }))).toContain('the intro has an empty paragraph');
    expect(guideProblems(input({ intro: [[{ text: 'x', href: 'http://example.com' }]] }))).toContain(
      'the intro links to "http://example.com", which is not allowed',
    );
    const guide = defineGuide(
      input({
        summary: 'One.',
        intro: ['Two three.'],
        sections: [
          {
            heading: 'Four',
            blocks: [
              { type: 'table', caption: 'Five', head: ['Six'], rows: [['Seven eight']] },
              { type: 'example', label: 'Nine', lines: ['Ten.'] },
            ],
          },
        ],
        closing: { heading: 'Eleven', text: 'Twelve.' },
      }),
    );
    expect(guide.wordCount).toBe(12);
  });

  it('makes anchors that are safe in a URL', () => {
    expect(headingId('  Café menus: the “basics”  ')).toBe('cafe-menus-the-basics');
    expect(headingId('Quiz nights & match days')).toBe('quiz-nights-and-match-days');
  });
});

describe('guide lookups', () => {
  it('builds the paths the pages and share images use', () => {
    expect(guidePath('abc')).toBe('/guides/abc');
    expect(guideImagePath('abc')).toBe('/og/guides/abc');
  });

  it('finds a guide by slug', () => {
    expect(findGuide(SAMPLE_GUIDES, storiesGuide.slug)).toBe(storiesGuide);
    expect(findGuide(SAMPLE_GUIDES, 'missing')).toBeUndefined();
  });

  it('groups by category in category order and leaves out empty categories', () => {
    expect(guidesByCategory(SAMPLE_GUIDES).map((group) => [group.category.id, group.guides.map((g) => g.slug)])).toEqual([
      ['planning', [planningGuide.slug]],
      ['photos', [storiesGuide.slug]],
    ]);
  });

  it('orders newest first and finds the latest update', () => {
    expect(latestGuides([storiesGuide, planningGuide]).map((guide) => guide.slug)).toEqual([
      planningGuide.slug,
      storiesGuide.slug,
    ]);
    expect(latestGuides(SAMPLE_GUIDES, 1)).toHaveLength(1);
    expect(lastUpdated(SAMPLE_GUIDES)).toBe('2026-09-29');
    expect(lastUpdated([])).toBeNull();
  });

  it('suggests named guides first, then the same category, then the rest, never the guide itself', () => {
    const sameCategory = defineGuide(input({ slug: 'same-category', category: 'planning', updated: '2026-09-20' }));
    const other = defineGuide(input({ slug: 'other-category', category: 'events', updated: '2026-09-25' }));
    const all = [planningGuide, storiesGuide, sameCategory, other];

    expect(relatedGuides(planningGuide, all).map((guide) => guide.slug)).toEqual([
      storiesGuide.slug,
      'same-category',
      'other-category',
    ]);
    expect(relatedGuides(planningGuide, all, 2)).toHaveLength(2);
    expect(relatedGuides(storiesGuide, all).map((guide) => guide.slug)).not.toContain(storiesGuide.slug);
  });
});
