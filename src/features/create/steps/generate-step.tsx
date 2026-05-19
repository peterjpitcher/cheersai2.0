'use client';

import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { generateContent, regenerateWithModifier } from '@/app/actions/ai-generate';
import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import type { PlatformCopy, Platform } from '@/types/content';
import type { PostprocessResult } from '@/lib/ai/postprocess';
import { useToast } from '@/components/providers/toast-provider';

// ---------------------------------------------------------------------------
// Modifier chips (D-06)
// ---------------------------------------------------------------------------

const MODIFIER_CHIPS = [
  { id: 'shorter', label: 'Make shorter', modifier: 'Make the copy shorter and more concise.' },
  { id: 'formal', label: 'More formal', modifier: 'Increase formality while keeping warmth.' },
  { id: 'emoji', label: 'Add emoji', modifier: 'Add relevant emojis to enhance the message.' },
  { id: 'cta', label: 'Stronger CTA', modifier: 'Strengthen the call-to-action with more urgency.' },
  { id: 'casual', label: 'More casual', modifier: 'Make the tone more relaxed and conversational.' },
  { id: 'longer', label: 'More detail', modifier: 'Add more specific details and description.' },
] as const;

// ---------------------------------------------------------------------------
// Helpers: map AiGenerationResponse to PlatformCopy
// ---------------------------------------------------------------------------

/**
 * Convert snake_case AI response to camelCase PlatformCopy.
 * The AI action returns AiGenerationResponse (snake_case) but the wizard
 * state uses PlatformCopy (camelCase).
 */
function toPlatformCopy(raw: PostprocessResult['copy']): PlatformCopy {
  return {
    facebook: {
      body: raw.facebook.body,
      ctaText: raw.facebook.cta_text ?? undefined,
      hashtags: raw.facebook.hashtags ?? undefined,
    },
    instagram: {
      body: raw.instagram.body,
      hashtags: raw.instagram.hashtags ?? undefined,
      linkInBioLine: raw.instagram.link_in_bio_line ?? undefined,
    },
    gbp: {
      body: raw.gbp.body,
      ctaAction: raw.gbp.cta_action ?? undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GenerateStepProps {
  contentId: string | null;
  contentBrief: ContentBrief;
  generatedCopy: PlatformCopy | null;
  onCopyChange: (copy: PlatformCopy) => void;
  warnings: string[];
  onWarningsChange: (warnings: string[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 2: AI content generation.
 *
 * Calls generateContent/regenerateWithModifier server actions via React Query
 * mutations. Displays platform-specific copy in side-by-side columns (D-07).
 * Modifier chips allow refinement (D-06). Warnings displayed as amber alerts.
 */
export function GenerateStep({
  contentId,
  contentBrief,
  generatedCopy,
  onCopyChange,
  warnings,
  onWarningsChange,
}: GenerateStepProps): React.JSX.Element {
  const platforms = (contentBrief.platforms ?? []) as Platform[];
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // --- Generate mutation ---
  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!contentId) throw new Error('Draft must be saved before generating');
      return generateContent(contentId, contentBrief);
    },
    onSuccess: (result) => {
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      if (result.data) {
        onCopyChange(toPlatformCopy(result.data.copy));
        onWarningsChange(result.data.warnings);
        setError(null);
      }
    },
    onError: (err: Error) => {
      const msg = err.message.includes('timeout') || err.message.includes('Timeout')
        ? 'Generation took too long -- please try again with a simpler brief.'
        : err.message;
      setError(msg);
      toast.error(msg);
    },
  });

  // --- Regenerate mutation ---
  const regenerateMutation = useMutation({
    mutationFn: async (modifier: string) => {
      if (!contentId) throw new Error('Draft must be saved before regenerating');
      return regenerateWithModifier(contentId, contentBrief, modifier);
    },
    onSuccess: (result) => {
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      if (result.data) {
        onCopyChange(toPlatformCopy(result.data.copy));
        onWarningsChange(result.data.warnings);
        setError(null);
        toast.success('Content regenerated');
      }
    },
    onError: (err: Error) => {
      setError(err.message);
      toast.error(err.message);
    },
  });

  const isGenerating = generateMutation.isPending || regenerateMutation.isPending;

  const handleGenerate = useCallback(() => {
    setError(null);
    generateMutation.mutate();
  }, [generateMutation]);

  const handleRegenerate = useCallback((modifier: string) => {
    setError(null);
    regenerateMutation.mutate(modifier);
  }, [regenerateMutation]);

  // --- Loading state: skeleton loaders per platform column ---
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

  // --- Error state ---
  if (error && !generatedCopy) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="rounded-full bg-destructive/10 p-4">
          <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">Generation failed</h3>
          <p className="text-sm text-muted-foreground max-w-md">{error}</p>
        </div>
        <Button type="button" onClick={handleGenerate}>
          <RotateCcw className="size-4 mr-1.5" aria-hidden="true" />
          Try Again
        </Button>
      </div>
    );
  }

  // --- Placeholder state: no copy generated yet ---
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
        <Button type="button" onClick={handleGenerate} disabled={!contentId}>
          <Sparkles className="size-4 mr-1.5" aria-hidden="true" />
          Generate Content
        </Button>
        {!contentId && (
          <p className="text-xs text-muted-foreground">Save your brief first to enable generation.</p>
        )}
      </div>
    );
  }

  // --- Generated state: platform columns with editable content (D-07) ---
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Generated Content</h3>

      {/* Warnings (AI-08) */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((warning, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg p-3 text-sm"
              style={{ background: 'var(--c-orange-soft)', border: '1px solid var(--c-orange)', borderRadius: 'var(--r-lg)', color: 'var(--c-ink)' }}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Platform columns */}
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
                  <div className="flex flex-wrap gap-1">
                    {copy.hashtags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {'ctaText' in copy && copy.ctaText && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">CTA</span>
                  <p className="text-sm text-foreground">{copy.ctaText}</p>
                </div>
              )}

              {'linkInBioLine' in copy && copy.linkInBioLine && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Link in Bio</span>
                  <p className="text-sm text-foreground">{copy.linkInBioLine}</p>
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
          {MODIFIER_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
              onClick={() => handleRegenerate(chip.modifier)}
              disabled={isGenerating}
            >
              {isGenerating && (
                <Loader2 className="mr-1 inline-block size-3 animate-spin" aria-hidden="true" />
              )}
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error display for regeneration failures */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
