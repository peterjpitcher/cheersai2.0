'use client';

import { useCallback, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { generateContent, regenerateWithModifier } from '@/app/actions/ai-generate';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { useToast } from '@/components/providers/toast-provider';
import type { ContentBrief } from '@/features/create/schemas/content-schemas';
import type {
  GenerationBatchContext,
  Platform,
  PlatformCopy,
  ScheduleSlot,
  SlotGeneratedCopy,
} from '@/types/content';
import type { PostprocessResult } from '@/lib/ai/postprocess';
import { BannerOverlay } from '@/features/planner/banner-overlay';
import { bannerConfigResolver } from '@/lib/banner/config';
import type { AccountBannerDefaults } from '@/lib/banner/config';
import type { MediaAssetSummary } from '@/lib/library/data';

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
// Helpers
// ---------------------------------------------------------------------------

/** Run async tasks with bounded concurrency (replaces p-limit for webpack compat) */
function limitConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  return Promise.allSettled(workers).then(() => results);
}

/** Convert a ScheduleSlot to an ISO timestamp in Europe/London */
function slotToIso(slot: ScheduleSlot): string {
  return DateTime.fromISO(`${slot.date}T${slot.time}`, { zone: DEFAULT_TIMEZONE }).toISO()!;
}

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

/** Format a slot for display in card headers */
function formatSlotHeader(slot: ScheduleSlot): string {
  const dt = DateTime.fromISO(`${slot.date}T${slot.time}`, { zone: DEFAULT_TIMEZONE });
  return dt.toFormat('EEE d MMM, HH:mm');
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GenerateStepProps {
  contentId: string | null;
  contentBrief: ContentBrief;
  selectedSlots: ScheduleSlot[];
  generatedSlotCopies: SlotGeneratedCopy[];
  onSlotCopiesChange: (copies: SlotGeneratedCopy[]) => void;
  selectedMediaIds: string[];
  publishMode: 'now' | 'schedule';
  isContextStale: boolean;
  onGeneratedWithContext: (ctx: GenerationBatchContext) => void;
  onSaveDraft: () => Promise<void>;
  onScheduleAll: () => Promise<void>;
  onQueueAll: () => Promise<void>;
  isSubmitting: boolean;
  libraryItems?: MediaAssetSummary[];
  bannerDefaults?: AccountBannerDefaults | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 3: AI content generation (final step).
 *
 * Multi-card batch generation — one card per schedule slot. Each card shows
 * platform-specific copy that can be edited inline. Modifier chips allow
 * refinement per slot. Final action buttons schedule/queue all ready cards.
 */
export function GenerateStep({
  contentId,
  contentBrief,
  selectedSlots,
  generatedSlotCopies,
  onSlotCopiesChange,
  selectedMediaIds,
  publishMode,
  isContextStale,
  onGeneratedWithContext,
  onSaveDraft,
  onScheduleAll,
  onQueueAll,
  isSubmitting,
  libraryItems,
  bannerDefaults,
}: GenerateStepProps): React.JSX.Element {
  const platforms = (contentBrief.platforms ?? []) as Platform[];
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const toast = useToast();

  // Derive media preview and banner config for card rendering
  const firstMediaItem = useMemo(() => {
    if (!libraryItems?.length || !selectedMediaIds.length) return null;
    return libraryItems.find((item) => item.id === selectedMediaIds[0]) ?? null;
  }, [libraryItems, selectedMediaIds]);

  const bannerConfig = useMemo(() => {
    if (!bannerDefaults) return null;
    return bannerConfigResolver(bannerDefaults, {
      banner_enabled: null,
      banner_text_override: null,
      banner_position: null,
      banner_bg: null,
      banner_text_colour: null,
    });
  }, [bannerDefaults]);

  /** Auto-resize textarea to fit content */
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Resolve effective slots: for "Post Now" with no slots, create a virtual one
  const effectiveSlots: ScheduleSlot[] = useMemo(() =>
    publishMode === 'now' && selectedSlots.length === 0
      ? [{
          key: 'now',
          date: DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('yyyy-MM-dd'),
          time: DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('HH:mm'),
          source: 'manual' as const,
        }]
      : selectedSlots,
  [publishMode, selectedSlots]);

  const isBusy = isSubmitting || isSavingDraft || isScheduling || isQueueing || isGeneratingBatch;

  // Count ready vs total
  const readyCount = generatedSlotCopies.filter(sc => sc.status === 'ready').length;
  const totalCount = effectiveSlots.length;
  const allReady = readyCount === totalCount && totalCount > 0;
  const hasAnyGenerated = generatedSlotCopies.length > 0;

  // -----------------------------------------------------------------------
  // Toggle card expand/collapse
  // -----------------------------------------------------------------------

  const toggleCard = useCallback((key: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // -----------------------------------------------------------------------
  // Batch generation: generate all slots with bounded concurrency
  // -----------------------------------------------------------------------

  const handleGenerateAll = useCallback(async () => {
    if (!contentId) return;
    setIsGeneratingBatch(true);

    // Initialize all slots as pending
    const initialCopies: SlotGeneratedCopy[] = effectiveSlots.map(slot => ({
      slotKey: slot.key,
      scheduledAt: publishMode === 'now' && slot.key === 'now' ? null : slotToIso(slot),
      label: slot.label,
      copy: null,
      warnings: [],
      status: 'pending' as const,
    }));
    onSlotCopiesChange(initialCopies);

    // Expand all cards so user can watch progress
    setExpandedCards(new Set(effectiveSlots.map(s => s.key)));

    const results = [...initialCopies];

    const tasks = effectiveSlots.map((slot, index) =>
      async () => {
        // Mark as generating
        results[index] = { ...results[index], status: 'generating' };
        onSlotCopiesChange([...results]);

        try {
          const slotIso = publishMode === 'now' && slot.key === 'now'
            ? null
            : slotToIso(slot);

          const result = await generateContent(contentId, contentBrief, {
            mediaIds: selectedMediaIds,
            scheduledAt: slotIso,
            slotLabel: slot.label,
          });

          if (result.error) {
            results[index] = {
              ...results[index],
              status: 'failed',
              error: result.error,
            };
          } else if (result.data) {
            results[index] = {
              ...results[index],
              status: 'ready',
              copy: toPlatformCopy(result.data.copy),
              warnings: result.data.warnings,
              error: undefined,
            };
          }
        } catch (err) {
          results[index] = {
            ...results[index],
            status: 'failed',
            error: err instanceof Error ? err.message : 'Generation failed',
          };
        }

        onSlotCopiesChange([...results]);
      },
    );

    await limitConcurrency(tasks, 3);

    // Record generation context
    onGeneratedWithContext({
      mediaIds: selectedMediaIds,
      slots: effectiveSlots.map(s => ({
        key: s.key,
        date: s.date,
        time: s.time,
        label: s.label,
      })),
    });

    setIsGeneratingBatch(false);
  }, [contentId, contentBrief, effectiveSlots, selectedMediaIds, publishMode, onSlotCopiesChange, onGeneratedWithContext]);

  // -----------------------------------------------------------------------
  // Single-slot regeneration
  // -----------------------------------------------------------------------

  const handleRegenerateSlot = useCallback(async (slotKey: string, modifier?: string) => {
    if (!contentId) return;

    const slot = effectiveSlots.find(s => s.key === slotKey);
    if (!slot) return;

    // Mark slot as generating
    const updated = generatedSlotCopies.map(sc =>
      sc.slotKey === slotKey ? { ...sc, status: 'generating' as const, error: undefined } : sc,
    );
    onSlotCopiesChange(updated);

    try {
      const slotIso = publishMode === 'now' && slot.key === 'now'
        ? null
        : slotToIso(slot);

      const result = modifier
        ? await regenerateWithModifier(contentId, contentBrief, modifier, {
            mediaIds: selectedMediaIds,
            scheduledAt: slotIso,
            slotLabel: slot.label,
          })
        : await generateContent(contentId, contentBrief, {
            mediaIds: selectedMediaIds,
            scheduledAt: slotIso,
            slotLabel: slot.label,
          });

      const finalCopies = generatedSlotCopies.map(sc => {
        if (sc.slotKey !== slotKey) return sc;
        if (result.error) {
          return { ...sc, status: 'failed' as const, error: result.error };
        }
        if (result.data) {
          return {
            ...sc,
            status: 'ready' as const,
            copy: toPlatformCopy(result.data.copy),
            warnings: result.data.warnings,
            error: undefined,
          };
        }
        return sc;
      });
      onSlotCopiesChange(finalCopies);

      if (result.data && modifier) {
        toast.success('Content regenerated');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Regeneration failed';
      const failCopies = generatedSlotCopies.map(sc =>
        sc.slotKey === slotKey ? { ...sc, status: 'failed' as const, error: errorMsg } : sc,
      );
      onSlotCopiesChange(failCopies);
      toast.error(errorMsg);
    }
  }, [contentId, contentBrief, effectiveSlots, generatedSlotCopies, selectedMediaIds, publishMode, onSlotCopiesChange, toast]);

  // -----------------------------------------------------------------------
  // Inline editing: update platform copy in a specific slot
  // -----------------------------------------------------------------------

  const handleEditCopy = useCallback(
    (slotKey: string, platform: Platform, field: string, value: string) => {
      const updated = generatedSlotCopies.map(sc => {
        if (sc.slotKey !== slotKey || !sc.copy) return sc;
        return {
          ...sc,
          copy: {
            ...sc.copy,
            [platform]: { ...sc.copy[platform], [field]: value },
          },
        };
      });
      onSlotCopiesChange(updated);
    },
    [generatedSlotCopies, onSlotCopiesChange],
  );

  // -----------------------------------------------------------------------
  // Render: Save Draft button (reusable)
  // -----------------------------------------------------------------------

  const renderSaveDraftButton = (size?: 'sm' | 'default') => (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={async () => {
        setIsSavingDraft(true);
        try { await onSaveDraft(); } finally { setIsSavingDraft(false); }
      }}
      disabled={!contentId || isBusy}
    >
      {isSavingDraft ? (
        <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
      ) : (
        <FileText className="size-4 mr-1.5" aria-hidden="true" />
      )}
      Save as Draft
    </Button>
  );

  // -----------------------------------------------------------------------
  // Render: Placeholder state (nothing generated yet)
  // -----------------------------------------------------------------------

  if (!hasAnyGenerated && !isGeneratingBatch) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <Sparkles className="size-8 text-primary" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">Ready to generate</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {totalCount === 1
              ? `Click Generate to create AI-powered content for ${platforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}.`
              : `Click Generate All to create content for ${totalCount} schedule slot${totalCount === 1 ? '' : 's'} across ${platforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}.`
            }
          </p>
        </div>
        <Button type="button" onClick={handleGenerateAll} disabled={!contentId}>
          <Sparkles className="size-4 mr-1.5" aria-hidden="true" />
          {totalCount <= 1 ? 'Generate Content' : `Generate All (${totalCount})`}
        </Button>
        {!contentId && (
          <p className="text-xs text-muted-foreground">Save your brief first to enable generation.</p>
        )}
        <div className="flex gap-2 mt-4">
          {renderSaveDraftButton('sm')}
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render: Multi-card generated state
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Generated Content</h3>
        <span className="text-sm text-muted-foreground">
          {readyCount} of {totalCount} post{totalCount === 1 ? '' : 's'} ready
        </span>
      </div>

      {/* Stale-context warning */}
      {isContextStale && (
        <div
          className="flex items-start gap-2 rounded-lg p-3 text-sm"
          style={{ background: 'var(--c-orange-soft)', border: '1px solid var(--c-orange)', borderRadius: 'var(--r-lg)', color: 'var(--c-ink)' }}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Your media or schedule has changed since generation</p>
            <p className="text-xs" style={{ color: 'var(--c-ink-2)' }}>
              Regenerate to update. Schedule and Queue are disabled until you regenerate.
            </p>
          </div>
        </div>
      )}

      {/* Regenerate All button */}
      {hasAnyGenerated && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerateAll}
            disabled={!contentId || isGeneratingBatch}
          >
            {isGeneratingBatch ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-3.5 mr-1.5" aria-hidden="true" />
            )}
            Regenerate All
          </Button>
        </div>
      )}

      {/* Slot cards */}
      <div className="space-y-3">
        {effectiveSlots.map((slot) => {
          const slotCopy = generatedSlotCopies.find(sc => sc.slotKey === slot.key);
          const isExpanded = expandedCards.has(slot.key);
          const status = slotCopy?.status ?? 'pending';

          return (
            <div
              key={slot.key}
              className="rounded-lg border border-border overflow-hidden"
            >
              {/* Card header */}
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50"
                onClick={() => toggleCard(slot.key)}
              >
                <div className="flex items-center gap-3">
                  {/* Status indicator */}
                  {status === 'generating' && (
                    <Loader2 className="size-4 animate-spin text-primary" aria-label="Generating" />
                  )}
                  {status === 'ready' && (
                    <Check className="size-4 text-emerald-500" aria-label="Ready" />
                  )}
                  {status === 'failed' && (
                    <X className="size-4 text-destructive" aria-label="Failed" />
                  )}
                  {status === 'pending' && (
                    <div className="size-4 rounded-full border-2 border-muted-foreground/30" aria-label="Pending" />
                  )}

                  {/* Date/time */}
                  <span className="text-sm font-medium text-foreground">
                    {slot.key === 'now' ? 'Publish Now' : formatSlotHeader(slot)}
                  </span>

                  {/* Label badge */}
                  {slot.label && (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ background: 'var(--c-orange-soft)', color: 'var(--c-orange)' }}
                    >
                      {slot.label}
                    </span>
                  )}
                </div>

                {isExpanded ? (
                  <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
              </button>

              {/* Card body (collapsible) */}
              {isExpanded && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                  {/* Media preview */}
                  {firstMediaItem && firstMediaItem.mediaType === 'image' && firstMediaItem.previewUrl && (
                    <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-lg bg-muted">
                      {bannerConfig?.enabled && publishMode === 'schedule' && firstMediaItem.previewUrl ? (
                        <BannerOverlay
                          mediaUrl={firstMediaItem.previewUrl}
                          config={bannerConfig}
                          label={slot.label ?? contentBrief.title}
                          className="size-full"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={firstMediaItem.previewUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      )}
                    </div>
                  )}
                  {firstMediaItem && firstMediaItem.mediaType === 'video' && (
                    <div className="mb-3 flex aspect-video w-full items-center justify-center rounded-lg bg-muted">
                      <span className="text-xs text-muted-foreground">Video preview not available</span>
                    </div>
                  )}

                  {/* Generating skeleton */}
                  {status === 'generating' && (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {platforms.map((platform) => (
                        <div key={platform} className="space-y-2 rounded-lg border border-border p-3">
                          <PlatformBadge platform={platform} showLabel />
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-4 w-5/6" />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Failed state */}
                  {status === 'failed' && (
                    <div className="flex flex-col items-center gap-3 py-4">
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive w-full">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>{slotCopy?.error ?? 'Generation failed'}</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleRegenerateSlot(slot.key)}
                        disabled={isBusy}
                      >
                        <RotateCcw className="size-3.5 mr-1.5" aria-hidden="true" />
                        Retry
                      </Button>
                    </div>
                  )}

                  {/* Ready state: editable platform copy */}
                  {status === 'ready' && slotCopy?.copy && (
                    <>
                      {/* Warnings */}
                      {(slotCopy.warnings?.length ?? 0) > 0 && (
                        <div className="space-y-1.5">
                          {slotCopy.warnings!.map((warning, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 rounded-lg p-2.5 text-xs"
                              style={{ background: 'var(--c-orange-soft)', border: '1px solid var(--c-orange)', borderRadius: 'var(--r-lg)', color: 'var(--c-ink)' }}
                            >
                              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                              <span>{warning}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Platform columns */}
                      <div className="mx-auto w-full max-w-6xl">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          {platforms.map((platform) => {
                            const copy = slotCopy.copy?.[platform];
                            if (!copy) return null;

                            return (
                              <div key={platform} className="space-y-2 rounded-lg border border-border p-3">
                                <PlatformBadge platform={platform} showLabel />

                                <div className="space-y-1">
                                  <label
                                    className="text-xs font-medium text-muted-foreground"
                                    htmlFor={`body-${slot.key}-${platform}`}
                                  >
                                    Body
                                  </label>
                                  <textarea
                                    id={`body-${slot.key}-${platform}`}
                                    ref={autoResize}
                                    className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150 max-h-[50vh] overflow-y-auto"
                                    style={{ minHeight: '4.5rem' }}
                                    value={copy.body ?? ''}
                                    onChange={(e) => {
                                      handleEditCopy(slot.key, platform, 'body', e.target.value);
                                      autoResize(e.target);
                                    }}
                                  />
                                </div>

                                {'hashtags' in copy && copy.hashtags && copy.hashtags.length > 0 && (
                                  <div className="space-y-1">
                                    <span className="text-xs font-medium text-muted-foreground">Hashtags</span>
                                    <div className="flex flex-wrap gap-1">
                                      {copy.hashtags.map((tag: string, idx: number) => (
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
                      </div>

                      {/* Modifier chips for this slot */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Refine this slot</p>
                        <div className="flex flex-wrap gap-1.5">
                          {MODIFIER_CHIPS.map((chip) => (
                            <button
                              key={chip.id}
                              type="button"
                              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                              onClick={() => handleRegenerateSlot(slot.key, chip.modifier)}
                              disabled={isBusy}
                            >
                              {chip.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                            onClick={() => handleRegenerateSlot(slot.key)}
                            disabled={isBusy}
                          >
                            <RotateCcw className="mr-1 inline-block size-3" aria-hidden="true" />
                            Regenerate
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Pending state */}
                  {status === 'pending' && (
                    <p className="text-sm text-muted-foreground py-2">
                      Waiting for generation...
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Final action buttons */}
      <div className="flex flex-col gap-2 pt-4 border-t border-border sm:flex-row sm:justify-end sm:items-center">
        <span className="text-xs text-muted-foreground mr-auto hidden sm:block">
          {readyCount} of {totalCount} ready
        </span>

        {renderSaveDraftButton()}

        {publishMode === 'now' ? (
          <Button
            type="button"
            onClick={async () => {
              setIsQueueing(true);
              try { await onQueueAll(); } finally { setIsQueueing(false); }
            }}
            disabled={isBusy || !contentId || !allReady || isContextStale}
            size="lg"
          >
            {isQueueing ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4 mr-1.5" aria-hidden="true" />
            )}
            Post Now
          </Button>
        ) : (
          <Button
            type="button"
            onClick={async () => {
              setIsScheduling(true);
              try { await onScheduleAll(); } finally { setIsScheduling(false); }
            }}
            disabled={isBusy || !contentId || !allReady || isContextStale}
            size="lg"
          >
            {isScheduling ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarClock className="size-4 mr-1.5" aria-hidden="true" />
            )}
            {totalCount <= 1 ? 'Schedule' : `Schedule All (${readyCount})`}
          </Button>
        )}
      </div>
    </div>
  );
}
