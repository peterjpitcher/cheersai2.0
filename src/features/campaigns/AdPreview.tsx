import type { CtaType } from '@/types/campaigns';

interface AdPreviewProps {
  headline: string;
  primaryText: string;
  cta: CtaType;
  imageUrl?: string;
}

const CTA_LABELS: Record<CtaType, string> = {
  LEARN_MORE: 'Learn More',
  SIGN_UP: 'Sign Up',
  BOOK_NOW: 'Book Now',
  GET_QUOTE: 'Get Quote',
  CONTACT_US: 'Contact Us',
  SUBSCRIBE: 'Subscribe',
};

export function AdPreview({ headline, primaryText, cta, imageUrl }: AdPreviewProps) {
  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-navy to-brand-teal flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">CheersAI Demo</p>
          <p className="text-xs text-muted-foreground">Sponsored</p>
        </div>
      </div>

      {/* Primary text */}
      <div className="px-3 pb-3">
        <p className="text-sm text-foreground line-clamp-3">{primaryText}</p>
      </div>

      {/* Image area */}
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Ad creative" className="w-full aspect-square object-cover" />
      ) : (
        <div className="w-full aspect-[1.91/1] bg-gradient-to-br from-brand-navy/20 to-brand-teal/20 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">Creative placeholder</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-3 border-t border-border bg-muted/30">
        <p className="text-sm font-semibold text-foreground truncate pr-3">{headline}</p>
        <button
          type="button"
          className="flex-shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
        >
          {CTA_LABELS[cta]}
        </button>
      </div>
    </div>
  );
}
