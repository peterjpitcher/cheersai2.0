import type { RichText } from '@/content/rich-text';

/**
 * The shape of a guide (a public article at /guides/<slug>).
 *
 * Each article is one module in this folder that exports the result of
 * `defineGuide({...})` (src/lib/guides/define-guide.ts), which checks it and
 * adds the word count and reading time. The body is structured sections, not
 * HTML or Markdown: the pages render each block with React components, so an
 * article can never inject markup and every page looks the same.
 */

/** A calendar date, "2026-09-29". Guides are dated by the day, in UK time. */
export type IsoDate = `${number}-${number}-${number}`;

/** Category ids. Labels, descriptions and order live in categories.ts. */
export type GuideCategoryId = 'planning' | 'ideas' | 'events' | 'writing' | 'photos' | 'tools';

export type GuideBlock =
  | { readonly type: 'paragraph'; readonly text: RichText }
  /** An H3 inside a section. H3s are not listed in the table of contents. */
  | { readonly type: 'subheading'; readonly text: string }
  /** "bullets" for a plain list, "steps" for a numbered one. */
  | { readonly type: 'list'; readonly style: 'bullets' | 'steps'; readonly items: readonly RichText[] }
  | { readonly type: 'tip'; readonly title?: string; readonly text: RichText }
  /**
   * Wording to copy and adapt: a caption, a prompt or a reply. Each line is
   * its own paragraph; the label (for example "Facebook post") names the box.
   */
  | { readonly type: 'example'; readonly label?: string; readonly lines: readonly RichText[] }
  /**
   * A small table. The caption says what it shows; the first cell of each row
   * labels the row. Cells may be empty (a template for the reader to fill in).
   */
  | {
      readonly type: 'table';
      readonly caption: string;
      readonly head: readonly string[];
      readonly rows: readonly (readonly RichText[])[];
    };

export interface GuideSection {
  /** The section's H2, listed in the table of contents. */
  readonly heading: string;
  /** The heading's anchor. Made from the heading when left out. */
  readonly id?: string;
  readonly blocks: readonly GuideBlock[];
}

/** The closing call to action: the page adds the button, which follows the sign-up switch. */
export interface GuideClosing {
  readonly heading: string;
  readonly text: string;
}

/** What an article module writes. */
export interface GuideInput {
  /** The URL segment: lower-case words joined by hyphens. */
  readonly slug: string;
  /** The H1 and the title shared on social media. */
  readonly title: string;
  /** The page <title> for search, when it should differ from "<title> | Cheers". */
  readonly seoTitle?: string;
  /** The meta description: aim for 70 to 160 characters. */
  readonly description: string;
  readonly primaryKeyword: string;
  readonly secondaryKeywords: readonly string[];
  readonly category: GuideCategoryId;
  readonly published: IsoDate;
  /** The last real change to the content; the page shows it in London time. */
  readonly updated: IsoDate;
  /** The standfirst under the H1: one or two sentences saying what the reader will get. */
  readonly summary: string;
  /** Paragraphs before the first H2 that answer the reader's question straight away. */
  readonly intro?: readonly RichText[];
  readonly sections: readonly GuideSection[];
  readonly closing: GuideClosing;
  /** Slugs to list first under related guides; the rest are filled by category. */
  readonly related?: readonly string[];
}

export interface GuideSectionWithId extends GuideSection {
  readonly id: string;
}

/** An article as the site uses it: what the module wrote, plus what is computed from it. */
export interface Guide extends GuideInput {
  readonly sections: readonly GuideSectionWithId[];
  readonly wordCount: number;
  readonly readingMinutes: number;
}
