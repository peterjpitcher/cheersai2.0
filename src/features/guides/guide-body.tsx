import { Lightbulb } from 'lucide-react';

import type { Guide, GuideBlock } from '@/content/guides/types';
import { RichTextView } from '@/features/marketing/rich-text';

/**
 * A guide's body: one <section> per H2 (each with the anchor the table of
 * contents links to), and each block drawn by its own component. Blocks are
 * data, never HTML, so an article cannot inject markup.
 */
export function GuideBody({ guide }: { guide: Guide }): React.JSX.Element {
  return (
    <div className="space-y-12">
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
        <p className="text-[17px] leading-[1.7] text-ink-2">
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
  }
}
