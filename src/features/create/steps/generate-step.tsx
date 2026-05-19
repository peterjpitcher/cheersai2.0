'use client';

import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformBadge } from '@/components/ui/platform-badge';
import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import type { PlatformCopy, Platform } from '@/types/content';

// ---------------------------------------------------------------------------
// Modifier chips (D-06)
// ---------------------------------------------------------------------------

const MODIFIER_CHIPS = [
  'Make shorter',
  'More formal',
  'Add emoji',
  'Stronger CTA',
  'More casual',
  'More detail',
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GenerateStepProps {
  contentBrief: ContentBrief;
  generatedCopy: PlatformCopy | null;
  onGenerate: () => void;
  onRegenerate: (modifier: string) => void;
  isGenerating: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 2: AI content generation.
 *
 * Shows a placeholder prompt to generate, then displays platform-specific
 * copy in side-by-side columns (D-07). Modifier chips allow refinement (D-06).
 * AI generation logic is wired in Plan 05 -- this component receives callbacks.
 */
export function GenerateStep({
  contentBrief,
  generatedCopy,
  onGenerate,
  onRegenerate,
  isGenerating,
}: GenerateStepProps): React.JSX.Element {
  const platforms = (contentBrief.platforms ?? []) as Platform[];

  // Loading state: skeleton loaders per platform column
  if (isGenerating) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Generating content...</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {platforms.map((platform) => (
            <div key={platform} className="space-y-3 rounded-lg border border-border p-4">
              <PlatformBadge platform={platform} showLabel />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Placeholder state: no copy generated yet
  if (!generatedCopy) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <Sparkles className="size-8 text-primary" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">Ready to generate</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Click Generate to create AI-powered content for{' '}
            {platforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}.
          </p>
        </div>
        <Button type="button" onClick={onGenerate}>
          <Sparkles className="size-4 mr-1.5" aria-hidden="true" />
          Generate Content
        </Button>
      </div>
    );
  }

  // Generated state: platform columns with editable content (D-07)
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Generated Content</h3>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {platforms.map((platform) => {
          const copy = generatedCopy[platform];
          if (!copy) return null;

          return (
            <div key={platform} className="space-y-3 rounded-lg border border-border p-4">
              <PlatformBadge platform={platform} showLabel />

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor={`body-${platform}`}>
                  Body
                </label>
                <textarea
                  id={`body-${platform}`}
                  rows={5}
                  className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150 resize-none"
                  defaultValue={copy.body}
                />
              </div>

              {'hashtags' in copy && copy.hashtags && copy.hashtags.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Hashtags</span>
                  <p className="text-sm text-foreground">{copy.hashtags.join(' ')}</p>
                </div>
              )}

              {'ctaText' in copy && copy.ctaText && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">CTA</span>
                  <p className="text-sm text-foreground">{copy.ctaText}</p>
                </div>
              )}

              {'ctaAction' in copy && copy.ctaAction && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">CTA Action</span>
                  <p className="text-sm text-foreground">{copy.ctaAction}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modifier chips (D-06) */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Refine the output</p>
        <div className="flex flex-wrap gap-2">
          {MODIFIER_CHIPS.map((modifier) => (
            <button
              key={modifier}
              type="button"
              className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
              onClick={() => onRegenerate(modifier)}
              disabled={isGenerating}
            >
              {isGenerating && (
                <Loader2 className="mr-1 inline-block size-3 animate-spin" aria-hidden="true" />
              )}
              {modifier}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
