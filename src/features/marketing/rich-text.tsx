import Link from 'next/link';
import { Fragment } from 'react';

import { richTextPieces, type RichText } from '@/content/rich-text';

interface RichTextViewProps {
  value: RichText;
}

const LINK_CLASS =
  'font-medium text-orange-hi underline decoration-orange-hi/40 underline-offset-[3px] transition-colors hover:decoration-orange-hi';

/**
 * Renders structured text (src/content/rich-text.ts) as React text: plain
 * words, bold words and links. There is no HTML to inject, so content modules
 * cannot add markup. Paths on this site use next/link.
 */
export function RichTextView({ value }: RichTextViewProps): React.JSX.Element {
  return (
    <>
      {richTextPieces(value).map((piece, index) => {
        if (typeof piece === 'string') return <Fragment key={index}>{piece}</Fragment>;
        if ('strong' in piece) {
          return (
            <strong key={index} className="font-semibold text-ink">
              {piece.strong}
            </strong>
          );
        }
        if (piece.href.startsWith('/')) {
          return (
            <Link key={index} href={piece.href} className={LINK_CLASS}>
              {piece.text}
            </Link>
          );
        }
        return (
          <a key={index} href={piece.href} className={LINK_CLASS} rel="noopener noreferrer">
            {piece.text}
          </a>
        );
      })}
    </>
  );
}
