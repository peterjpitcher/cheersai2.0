/**
 * Text for the public pages (homepage FAQs and guides): a plain string, or a
 * run of pieces where each piece is plain text, bold text or a link. There is
 * no HTML anywhere in it: the pages render every piece as React text, so copy
 * can never inject markup, and the plain-text form (for JSON-LD, word counts
 * and search snippets) is exactly what a reader sees.
 */

export interface StrongText {
  readonly strong: string;
}

export interface LinkText {
  readonly text: string;
  /** A path on this site ("/guides/..."), an https:// address or a mailto: address. */
  readonly href: string;
}

export type InlinePiece = string | StrongText | LinkText;

export type RichText = string | readonly InlinePiece[];

export function isLinkPiece(piece: InlinePiece): piece is LinkText {
  return typeof piece === 'object' && 'href' in piece;
}

export function richTextPieces(value: RichText): readonly InlinePiece[] {
  return typeof value === 'string' ? [value] : value;
}

/** The words a reader sees, with links and bold text as their plain words. */
export function plainText(value: RichText): string {
  return richTextPieces(value)
    .map((piece) => {
      if (typeof piece === 'string') return piece;
      return 'strong' in piece ? piece.strong : piece.text;
    })
    .join('');
}

/** Every link target in a piece of text. */
export function linkTargets(value: RichText): string[] {
  return richTextPieces(value)
    .filter(isLinkPiece)
    .map((piece) => piece.href);
}

/**
 * Links may go to a path on this site, an https:// address or a mailto:
 * address. Anything else (javascript:, data:, protocol-relative //host) is
 * refused, so a content module can never carry a dangerous link.
 */
export function isAllowedHref(href: string): boolean {
  return /^\/(?![/\\])\S*$/.test(href) || /^https:\/\/[^\s/]+\S*$/.test(href) || /^mailto:[^\s@]+@[^\s@]+$/.test(href);
}
