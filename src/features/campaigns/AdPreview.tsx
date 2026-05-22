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
    <div
      className="w-full max-w-sm overflow-hidden"
      style={{
        borderRadius: 'var(--r-xl)',
        border: '1px solid var(--c-line)',
        backgroundColor: 'var(--c-card)',
        boxShadow: 'var(--sh-sm)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-3">
        <div
          className="h-9 w-9 rounded-full flex-shrink-0"
          style={{ backgroundColor: 'var(--c-orange-soft)' }}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--c-ink)' }}>CheersAI Demo</p>
          <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Sponsored</p>
        </div>
      </div>

      {/* Primary text */}
      <div className="px-3 pb-3">
        <p className="text-sm line-clamp-3" style={{ color: 'var(--c-ink)' }}>{primaryText}</p>
      </div>

      {/* Image area */}
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Ad creative" className="w-full aspect-square object-contain" />
      ) : (
        <div
          className="w-full aspect-[1.91/1] flex items-center justify-center"
          style={{ backgroundColor: 'var(--c-paper-2)' }}
        >
          <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>Creative placeholder</span>
        </div>
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-between px-3 py-3"
        style={{
          borderTop: '1px solid var(--c-line)',
          backgroundColor: 'var(--c-paper)',
        }}
      >
        <p className="text-sm font-semibold truncate pr-3" style={{ color: 'var(--c-ink)' }}>{headline}</p>
        <button
          type="button"
          className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold transition-colors"
          style={{
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--c-line)',
            backgroundColor: 'var(--c-card)',
            color: 'var(--c-ink)',
          }}
        >
          {CTA_LABELS[cta]}
        </button>
      </div>
    </div>
  );
}
