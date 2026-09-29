import { Lightbulb } from 'lucide-react';

import type { Guide, GuideBlock } from '@/content/guides/types';
import { RichTextView } from '@/features/marketing/rich-text';

const PARAGRAPH = 'text-[17px] leading-[1.7] text-ink-2';

/**
 * A guide's body: the intro paragraphs, then one <section> per H2 (each with
 * the anchor the table of contents links to), and each block drawn by its own
 * component. Blocks are data, never HTML, so an article cannot inject markup.
 */
export function GuideBody({ guide }: { guide: Guide }): React.JSX.Element {
  // Long unbroken strings (a tracking link, a hashtag run) wrap instead of
  // pushing the page sideways on a phone.
  return (
    <div className="space-y-12 [overflow-wrap:break-word]">
      {guide.intro?.length ? (
        <div className="space-y-5">
          {guide.intro.map((paragraph, index) => (
            <p key={index} className={PARAGRAPH}>
              <RichTextView value={paragraph} />
            </p>
          ))}
        </div>
      ) : null}
      {guide.sections.map((section) => (
        <section key={section.id} aria-labelledby={section.id} className="space-y-5">
          <h2
            id={section.id}
            className="scroll-mt-6 text-2xl font-semibold leading-tight text-ink sm:text-[1.75rem]"
          >
            {section.heading}
          </h2>
          {section.blocks.map((block, index) => (
            <GuideBlockView key={index} block={block} />
          ))}
        </section>
      ))}
    </div>
  );
}

function GuideBlockView({ block }: { block: GuideBlock }): React.JSX.Element {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className={PARAGRAPH}>
          <RichTextView value={block.text} />
        </p>
      );
    case 'subheading':
      return <h3 className="pt-2 text-lg font-semibold leading-snug text-ink">{block.text}</h3>;
    case 'list':
      return block.style === 'steps' ? (
        <ol className="list-decimal space-y-2.5 pl-6 text-[17px] leading-[1.7] text-ink-2 marker:font-semibold marker:text-orange-hi">
          {block.items.map((item, index) => (
            <li key={index} className="pl-1.5">
              <RichTextView value={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-2.5 pl-6 text-[17px] leading-[1.7] text-ink-2 marker:text-orange">
          {block.items.map((item, index) => (
            <li key={index} className="pl-1.5">
              <RichTextView value={item} />
            </li>
          ))}
        </ul>
      );
    case 'tip':
      return (
        <div role="note" className="rounded-[var(--r-xl)] border border-orange-soft bg-orange-tint p-5">
          <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-orange-hi">
            <Lightbulb aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            {block.title ?? 'Tip'}
          </p>
          <p className="mt-2 text-base leading-relaxed text-ink-2">
            <RichTextView value={block.text} />
          </p>
        </div>
      );
    case 'example':
      return (
        <figure className="rounded-[var(--r-xl)] border border-line bg-card p-5">
          <figcaption className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-orange-hi">
            {block.label ?? 'Example'}
          </figcaption>
          <div className="mt-3 space-y-2 border-l-2 border-orange pl-4 text-base leading-relaxed text-ink">
            {block.lines.map((line, index) => (
              <p key={index}>
                <RichTextView value={line} />
              </p>
            ))}
          </div>
        </figure>
      );
    case 'table':
      // A wide table scrolls inside its own box, never the page; the box is
      // focusable so keyboard users can scroll it too. The caption shows above
      // the box so it wraps on a phone; screen readers get the table's own
      // <caption> and the region's label instead.
      return (
        <div className="rounded-[var(--r-xl)] border border-line bg-card">
          <p aria-hidden="true" className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
            {block.caption}
          </p>
          <div role="region" aria-label={block.caption} tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-[15px] leading-snug">
              <caption className="sr-only">{block.caption}</caption>
              <thead>
                <tr className="bg-paper-2">
                  {block.head.map((cell, index) => (
                    <th key={index} scope="col" className="border-b border-line px-4 py-3 font-semibold text-ink">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-line last:border-b-0">
                    {row.map((cell, cellIndex) =>
                      cellIndex === 0 ? (
                        <th key={cellIndex} scope="row" className="px-4 py-3 align-top font-semibold text-ink">
                          <RichTextView value={cell} />
                        </th>
                      ) : (
                        <td key={cellIndex} className="px-4 py-3 align-top text-ink-2">
                          <RichTextView value={cell} />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
  }
}
