'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MediaFrame, resolveMediaPlacement } from '@/components/media/media-frame';
import { MediaPicker } from '@/features/create/media/media-picker';
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
import { buildGenerationTemporalContext, getCreatePreviewBannerLabel } from '@/lib/create/temporal-context';
import type { MediaAssetSummary } from '@/lib/library/data';
import { composePublishBody } from '@/lib/publishing/compose-body';

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

function createEmptyStoryCopy(): PlatformCopy {
  return {
    facebook: { body: '' },
    instagram: { body: '' },
    gbp: { body: '' },
  };
}

function storyCopySignature(copies: SlotGeneratedCopy[]): string {
  return JSON.stringify(
    copies.map((copy) => ({
      slotKey: copy.slotKey,
      scheduledAt: copy.scheduledAt,
      label: copy.label ?? null,
      status: copy.status,
      approved: copy.approved === true,
      mediaIds: copy.mediaIds ?? null,
      facebookBody: copy.copy?.facebook.body ?? null,
      instagramBody: copy.copy?.instagram.body ?? null,
      gbpBody: copy.copy?.gbp.body ?? null,
    })),
  );
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
  accountId: string;
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
  accountId,
  libraryItems,
  bannerDefaults,
}: GenerateStepProps): React.JSX.Element {
  const platforms = (contentBrief.platforms ?? []) as Platform[];
  const contentPlacement =
    "placement" in contentBrief && typeof contentBrief.placement === "string"
      ? contentBrief.placement
      : "placements" in contentBrief &&
          Array.isArray(contentBrief.placements) &&
          contentBrief.placements.includes("story") &&
          !contentBrief.placements.includes("feed")
        ? "story"
      : null;
  const isStorySchedule = contentBrief.contentType === 'story' || contentPlacement === 'story';
  const previewPlacement = resolveMediaPlacement({
    placement: contentPlacement,
    contentType: contentBrief.contentType,
  });
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  // slotKey of the card whose media is being swapped (null = no modal open)
  const [mediaTargetSlot, setMediaTargetSlot] = useState<string | null>(null);
  const toast = useToast();

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

  // Resolve effective slots: for "Post Now" with no slots, create a virtual one.
  // Otherwise sort chronologically so cards read in date order (ISO strings sort
  // lexicographically = chronologically).
  const effectiveSlots: ScheduleSlot[] = useMemo(() =>
    publishMode === 'now' && selectedSlots.length === 0
      ? [{
          key: 'now',
          date: DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('yyyy-MM-dd'),
          time: DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('HH:mm'),
          source: 'manual' as const,
        }]
      : [...selectedSlots].sort((a, b) => slotToIso(a).localeCompare(slotToIso(b))),
  [publishMode, selectedSlots]);

  useEffect(() => {
    if (!isStorySchedule) return;

    const nextCopies: SlotGeneratedCopy[] = effectiveSlots.map((slot) => {
      const existing = generatedSlotCopies.find((copy) => copy.slotKey === slot.key);
      return {
        slotKey: slot.key,
        scheduledAt: publishMode === 'now' && slot.key === 'now' ? null : slotToIso(slot),
        label: slot.label,
        copy: createEmptyStoryCopy(),
        warnings: [],
        status: 'ready',
        approved: true,
        mediaIds: existing?.mediaIds,
      };
    });

    if (storyCopySignature(generatedSlotCopies) === storyCopySignature(nextCopies)) {
      return;
    }

    onSlotCopiesChange(nextCopies);
    setExpandedCards(new Set(effectiveSlots.map((slot) => slot.key)));
    onGeneratedWithContext({
      mediaIds: selectedMediaIds,
      slots: effectiveSlots.map((slot) => ({
        key: slot.key,
        date: slot.date,
        time: slot.time,
        label: slot.label,
      })),
    });
  }, [
    effectiveSlots,
    generatedSlotCopies,
    isStorySchedule,
    onGeneratedWithContext,
    onSlotCopiesChange,
    publishMode,
    selectedMediaIds,
  ]);

  const isBusy = isSubmitting || isSavingDraft || isScheduling || isQueueing || isGeneratingBatch;

  // Count ready / approved vs total
  const readyCount = generatedSlotCopies.filter(sc => sc.status === 'ready').length;
  const approvedCount = generatedSlotCopies.filter(sc => sc.approved && sc.status === 'ready' && sc.copy).length;
  const totalCount = effectiveSlots.length;
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
    if (isStorySchedule) return;
    setIsGeneratingBatch(true);

    // Initialize all slots as pending. Seed each slot's media from any existing
    // per-slot choice (preserved across "Regenerate All"), else the wizard-level
    // selection from the Media step.
    const initialCopies: SlotGeneratedCopy[] = effectiveSlots.map(slot => ({
      slotKey: slot.key,
      scheduledAt: publishMode === 'now' && slot.key === 'now' ? null : slotToIso(slot),
      label: slot.label,
      copy: null,
      warnings: [],
      status: 'pending' as const,
      mediaIds: generatedSlotCopies.find(sc => sc.slotKey === slot.key)?.mediaIds ?? selectedMediaIds,
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
          const temporalContext = buildGenerationTemporalContext({
            contentType: contentBrief.contentType,
            brief: contentBrief as Record<string, unknown>,
            scheduledAt: slotIso,
          });

          const result = await generateContent(contentId, contentBrief, {
            mediaIds: selectedMediaIds,
            scheduledAt: slotIso,
            slotLabel: slot.label,
            ...temporalContext,
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
  }, [contentId, contentBrief, effectiveSlots, selectedMediaIds, publishMode, onSlotCopiesChange, onGeneratedWithContext, generatedSlotCopies, isStorySchedule]);

  // -----------------------------------------------------------------------
  // Single-slot regeneration
  // -----------------------------------------------------------------------

  const handleRegenerateSlot = useCallback(async (slotKey: string, modifier?: string) => {
    if (!contentId) return;
    if (isStorySchedule) return;

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
      const temporalContext = buildGenerationTemporalContext({
        contentType: contentBrief.contentType,
        brief: contentBrief as Record<string, unknown>,
        scheduledAt: slotIso,
      });

      const result = modifier
        ? await regenerateWithModifier(contentId, contentBrief, modifier, {
            mediaIds: selectedMediaIds,
            scheduledAt: slotIso,
            slotLabel: slot.label,
            ...temporalContext,
          })
        : await generateContent(contentId, contentBrief, {
            mediaIds: selectedMediaIds,
            scheduledAt: slotIso,
            slotLabel: slot.label,
            ...temporalContext,
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
  }, [contentId, contentBrief, effectiveSlots, generatedSlotCopies, selectedMediaIds, publishMode, onSlotCopiesChange, toast, isStorySchedule]);

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
  // Per-card approval: lock a reviewed card and include it in scheduling
  // -----------------------------------------------------------------------

  const handleToggleApprove = useCallback(
    (slotKey: string, approved: boolean) => {
      const updated = generatedSlotCopies.map(sc =>
        sc.slotKey === slotKey ? { ...sc, approved } : sc,
      );
      onSlotCopiesChange(updated);
    },
    [generatedSlotCopies, onSlotCopiesChange],
  );

  // -----------------------------------------------------------------------
  // Per-card media: swap the media attached to a single slot
  // -----------------------------------------------------------------------

  const handleSlotMediaChange = useCallback(
    (slotKey: string, mediaIds: string[]) => {
      const updated = generatedSlotCopies.map(sc =>
        sc.slotKey === slotKey ? { ...sc, mediaIds } : sc,
      );
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

  if (isStorySchedule && !hasAnyGenerated) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <CalendarClock className="size-8 text-primary" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">Preparing story schedule</h3>
        </div>
        <div className="flex gap-2 mt-4">
          {renderSaveDraftButton('sm')}
        </div>
      </div>
    );
  }

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
        <h3 className="text-lg font-semibold text-foreground">
          {isStorySchedule ? 'Story Schedule' : 'Generated Content'}
        </h3>
        <span className="text-sm text-muted-foreground">
          {readyCount} of {totalCount} {isStorySchedule ? 'story slot' : 'post'}{totalCount === 1 ? '' : 's'} ready
        </span>
      </div>

      {/* Stale-context warning */}
      {isContextStale && !isStorySchedule && (
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
      {hasAnyGenerated && !isStorySchedule && (
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
          const isApproved = slotCopy?.approved === true;
          const previewScheduledAt = publishMode === 'now' && slot.key === 'now'
            ? null
            : slotCopy?.scheduledAt ?? slotToIso(slot);
          const bannerPreviewLabel = getCreatePreviewBannerLabel({
            contentType: contentBrief.contentType,
            brief: contentBrief as Record<string, unknown>,
            scheduledAt: previewScheduledAt,
            slotCount: effectiveSlots.length,
          });
          const slotMediaIds = slotCopy?.mediaIds ?? selectedMediaIds;
          const slotMedia = slotMediaIds
            .map((id) => libraryItems?.find((item) => item.id === id))
            .filter((item): item is MediaAssetSummary => Boolean(item));
          const primary = slotMedia[0] ?? null;
          const extraCount = slotMedia.length - 1;

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

                  {/* Approved badge */}
                  {isApproved && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      <Check className="size-3" aria-hidden="true" /> Approved
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

                  {/* Ready story state: media only, no generated copy */}
                  {status === 'ready' && slotCopy?.copy && isStorySchedule && (
                    <div className="space-y-3">
                      <div className="mx-auto w-full max-w-[260px]">
                        <MediaFrame
                          placement={previewPlacement}
                          size="preview"
                          className="rounded-md border-border bg-muted"
                        >
                          {primary && primary.mediaType === 'image' && primary.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={primary.previewUrl}
                              alt={primary.fileName ?? ''}
                              className="size-full object-contain"
                            />
                          ) : primary && primary.mediaType === 'video' ? (
                            <div className="flex size-full items-center justify-center">
                              <span className="text-xs text-muted-foreground">Video attached — no preview</span>
                            </div>
                          ) : (
                            <div className="flex size-full items-center justify-center">
                              <span className="text-xs text-muted-foreground">No media attached</span>
                            </div>
                          )}
                          {extraCount > 0 && (
                            <span className="absolute bottom-2 left-2 rounded-full bg-foreground/80 px-2 py-0.5 text-xs font-medium text-background">
                              +{extraCount} more
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setMediaTargetSlot(slot.key)}
                            disabled={isBusy}
                            aria-haspopup="dialog"
                            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-semibold text-background shadow-sm transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <ImagePlus className="size-3.5" aria-hidden="true" /> {primary ? 'Replace' : 'Add'}
                          </button>
                        </MediaFrame>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2">
                        {platforms.map((platform) => (
                          <PlatformBadge key={platform} platform={platform} showLabel />
                        ))}
                      </div>
                      <div className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                        <Check className="size-4" aria-hidden="true" /> Story media ready to schedule
                      </div>
                    </div>
                  )}

                  {/* Ready state: editable platform copy */}
                  {status === 'ready' && slotCopy?.copy && !isStorySchedule && (
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
                            const finalPreview = composePublishBody(platform, copy, {
                              ctaLinks: contentBrief.ctaLinks,
                              contentType: contentBrief.contentType,
                            });

                            return (
                              <div key={platform} className="space-y-2 rounded-lg border border-border p-3">
                                <MediaFrame
                                  placement={previewPlacement}
                                  size="preview"
                                  className="rounded-md border-border bg-muted"
                                >
                                  {primary && primary.mediaType === 'image' && primary.previewUrl ? (
                                    bannerConfig?.enabled && publishMode === 'schedule' ? (
                                      <BannerOverlay
                                        mediaUrl={primary.previewUrl}
                                        config={bannerConfig}
                                        label={bannerPreviewLabel}
                                        className="size-full"
                                      />
                                    ) : (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={primary.previewUrl}
                                        alt={primary.fileName ?? ''}
                                        className="size-full object-contain"
                                      />
                                    )
                                  ) : primary && primary.mediaType === 'video' ? (
                                    <div className="flex size-full items-center justify-center">
                                      <span className="text-xs text-muted-foreground">Video attached — no preview</span>
                                    </div>
                                  ) : (
                                    <div className="flex size-full items-center justify-center">
                                      <span className="text-xs text-muted-foreground">No media attached</span>
                                    </div>
                                  )}
                                  {extraCount > 0 && (
                                    <span className="absolute bottom-2 left-2 rounded-full bg-foreground/80 px-2 py-0.5 text-xs font-medium text-background">
                                      +{extraCount} more
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setMediaTargetSlot(slot.key)}
                                    disabled={isBusy || isApproved}
                                    aria-haspopup="dialog"
                                    className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-semibold text-background shadow-sm transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <ImagePlus className="size-3.5" aria-hidden="true" /> {primary ? 'Replace' : 'Add'}
                                  </button>
                                </MediaFrame>

                                <PlatformBadge platform={platform} showLabel />

                                <div className="min-w-0 space-y-1">
                                  <label
                                    className="text-xs font-medium text-muted-foreground"
                                    htmlFor={`publish-preview-${slot.key}-${platform}`}
                                  >
                                    Final publish preview
                                  </label>
                                  <textarea
                                    id={`publish-preview-${slot.key}-${platform}`}
                                    ref={autoResize}
                                    readOnly={isApproved}
                                    className={`flex w-full resize-y rounded-md border border-input px-3 py-2 text-sm leading-relaxed shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150 max-h-[50vh] overflow-y-auto break-words ${isApproved ? 'bg-muted/40 cursor-not-allowed text-muted-foreground' : 'bg-card'}`}
                                    style={{ minHeight: '10rem' }}
                                    value={finalPreview}
                                    onChange={(e) => {
                                      handleEditCopy(slot.key, platform, 'publishBodyOverride', e.target.value);
                                      autoResize(e.target);
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Refine + approve controls */}
                      {isApproved ? (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                            <Check className="size-4" aria-hidden="true" /> Approved — ready to schedule
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleApprove(slot.key, false)}
                            disabled={isBusy}
                          >
                            Edit
                          </Button>
                        </div>
                      ) : (
                        <>
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
                          {/* Approve this card */}
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleToggleApprove(slot.key, true)}
                              disabled={isBusy}
                            >
                              <Check className="size-3.5 mr-1.5" aria-hidden="true" /> Approve this post
                            </Button>
                          </div>
                        </>
                      )}
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
          {isStorySchedule
            ? `${readyCount} of ${totalCount} story slot${totalCount === 1 ? '' : 's'} ready`
            : `${approvedCount} approved · ${readyCount} of ${totalCount} ready`}
        </span>

        {renderSaveDraftButton()}

        {publishMode === 'now' ? (
          <Button
            type="button"
            onClick={async () => {
              setIsQueueing(true);
              try { await onQueueAll(); } finally { setIsQueueing(false); }
            }}
            disabled={isBusy || !contentId || approvedCount === 0 || (!isStorySchedule && isContextStale)}
            size="lg"
          >
            {isQueueing ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4 mr-1.5" aria-hidden="true" />
            )}
            {isStorySchedule ? `Post stories (${approvedCount})` : `Post approved (${approvedCount})`}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={async () => {
              setIsScheduling(true);
              try { await onScheduleAll(); } finally { setIsScheduling(false); }
            }}
            disabled={isBusy || !contentId || approvedCount === 0 || (!isStorySchedule && isContextStale)}
            size="lg"
          >
            {isScheduling ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarClock className="size-4 mr-1.5" aria-hidden="true" />
            )}
            {isStorySchedule ? `Schedule stories (${approvedCount})` : `Schedule approved (${approvedCount})`}
          </Button>
        )}
      </div>

      {/* Per-card media swap modal */}
      {mediaTargetSlot ? (() => {
        const targetSlot = effectiveSlots.find((s) => s.key === mediaTargetSlot);
        const targetCopy = generatedSlotCopies.find((sc) => sc.slotKey === mediaTargetSlot);
        return (
          <SlotMediaModal
            title={targetSlot?.label ?? contentBrief.title ?? 'This post'}
            accountId={accountId}
            campaignName={contentBrief.title}
            libraryItems={libraryItems ?? []}
            selectedMediaIds={targetCopy?.mediaIds ?? selectedMediaIds}
            onMediaChange={(ids) => handleSlotMediaChange(mediaTargetSlot, ids)}
            onClose={() => setMediaTargetSlot(null)}
          />
        );
      })() : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-slot media swap modal — reuses MediaPicker (library browse + upload)
// ---------------------------------------------------------------------------

interface SlotMediaModalProps {
  title: string;
  accountId: string;
  campaignName?: string;
  libraryItems: MediaAssetSummary[];
  selectedMediaIds: string[];
  onMediaChange: (ids: string[]) => void;
  onClose: () => void;
}

function SlotMediaModal({
  title,
  accountId,
  campaignName,
  libraryItems,
  selectedMediaIds,
  onMediaChange,
  onClose,
}: SlotMediaModalProps): React.JSX.Element | null {
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close media picker"
        className="absolute inset-0 z-0 bg-foreground/50 backdrop-blur-sm"
      />
      <div className="relative z-10 my-6 w-full max-w-2xl overflow-hidden rounded-lg bg-card shadow-2xl ring-1 ring-border">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Media for this post</p>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border p-1.5 text-muted-foreground transition hover:text-foreground"
            aria-label="Close media picker"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="max-h-[80vh] overflow-y-auto p-6">
          <MediaPicker
            accountId={accountId}
            campaignName={campaignName}
            libraryItems={libraryItems}
            selectedMediaIds={selectedMediaIds}
            onMediaChange={onMediaChange}
          />
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" onClick={onClose}>Done</Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
