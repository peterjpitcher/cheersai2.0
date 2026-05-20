'use client';

import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { DateTime } from 'luxon';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import { useAutoSaveDraft } from '@/lib/content/draft-autosave';
import { createDraft, getDraft, saveDraft, createScheduledBatch } from '@/app/actions/content';
import { attachMediaToContent } from '@/app/actions/media';
import { getCreateModalData } from '@/features/create/create-modal-actions';
import type { MediaAssetSummary } from '@/lib/library/data';
import { contentBriefSchema } from '@/features/create/schemas/content-schemas';
import type { ContentBrief, ContentBriefInput } from '@/features/create/schemas/content-schemas';
import type {
  ContentType,
  DraftState,
  GenerationBatchContext,
  Platform,
  ScheduleSlot,
  SlotGeneratedCopy,
} from '@/types/content';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

import { BriefStep } from '@/features/create/steps/brief-step';
import { GenerateStep } from '@/features/create/steps/generate-step';
import { MediaStep } from '@/features/create/steps/media-step';
import { ScheduleStep } from '@/features/create/steps/schedule-step';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_LABELS = ['Brief', 'Media', 'Schedule', 'Generate'] as const;

const CONTENT_TYPE_LABELS: Record<string, string> = {
  instant_post: 'Instant Post',
  story: 'Story',
  event: 'Event',
  promotion: 'Promotion',
  weekly_recurring: 'Weekly Recurring',
};

const STEP_ANIMATION = {
  initial: (direction: number) => ({ x: direction > 0 ? 80 : -80, opacity: 0 }),
  animate: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -80 : 80, opacity: 0 }),
  transition: { duration: 0.25, ease: 'easeInOut' as const },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateWizardProps {
  initialDraftId?: string;
  accountId: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * 4-step create wizard: Brief -> Media -> Schedule -> Generate.
 *
 * Manages step navigation, form state via React Hook Form + Zod, auto-save on
 * step transitions (D-03), and draft resume via initialDraftId.
 * Media and schedule context collected before AI generation so copy can be
 * written with the actual publishing context in mind.
 */
export function CreateWizard({ initialDraftId, accountId, onClose }: CreateWizardProps): React.JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<ScheduleSlot[]>([]);
  const [generatedSlotCopies, setGeneratedSlotCopies] = useState<SlotGeneratedCopy[]>([]);
  const [lastGenerationContext, setLastGenerationContext] = useState<GenerationBatchContext | null>(null);
  const [isSubmitting] = useState(false);
  const [libraryItems, setLibraryItems] = useState<MediaAssetSummary[]>([]);
  const toast = useToast();

  const { save, isSaving } = useAutoSaveDraft(draftId);

  // ContentBrief is a discriminated union with default fields, so the Zod
  // input type differs from the output type. We type the form as ContentBriefInput
  // and cast the resolver to satisfy both React Hook Form and Zod.
  const form = useForm<ContentBriefInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(contentBriefSchema) as any,
    defaultValues: {
      contentType: 'instant_post',
      title: '',
      prompt: '',
      platforms: ['facebook', 'instagram', 'gbp'],
      tone: 'friendly_warm',
      lengthPreference: 'standard',
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: 'default',
      proofPoints: [],
      publishMode: 'now',
    },
    mode: 'onTouched',
  });

  const watchedContentType = form.watch('contentType') as string;
  const watchedPublishMode = (form.watch('publishMode') as 'now' | 'schedule') ?? 'now';

  // -----------------------------------------------------------------------
  // Resume existing draft
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!initialDraftId) return;

    async function loadDraft(): Promise<void> {
      const result = await getDraft(initialDraftId!);
      if (result.data?.bodyDraft) {
        const draft = result.data.bodyDraft as unknown as DraftState;
        if (draft.step != null) setCurrentStep(draft.step);
        if (draft.brief) {
          form.reset(draft.brief as ContentBriefInput);
        }
        if (draft.selectedMediaIds) setSelectedMediaIds(draft.selectedMediaIds);

        // Multi-slot restore (canonical path)
        if (draft.selectedSlots) {
          setSelectedSlots(draft.selectedSlots);
        } else if (draft.scheduledAt) {
          // Legacy single-slot: migrate to ScheduleSlot format
          const dt = DateTime.fromISO(draft.scheduledAt, { zone: DEFAULT_TIMEZONE });
          const migratedSlot: ScheduleSlot = {
            key: `migrated:${draft.scheduledAt}`,
            date: dt.toFormat('yyyy-MM-dd'),
            time: dt.toFormat('HH:mm'),
            source: 'migrated',
          };
          setSelectedSlots([migratedSlot]);
        }

        // Generated copy restore
        if (draft.generatedSlotCopies) {
          setGeneratedSlotCopies(draft.generatedSlotCopies);
        } else if (draft.generatedCopy) {
          // Legacy single-copy: wrap into a single SlotGeneratedCopy entry
          const slotKey = draft.selectedSlots?.[0]?.key
            ?? (draft.scheduledAt ? `migrated:${draft.scheduledAt}` : 'now');
          setGeneratedSlotCopies([{
            slotKey,
            scheduledAt: draft.scheduledAt ?? null,
            copy: draft.generatedCopy,
            warnings: [],
            status: 'ready',
          }]);
        }

        if (draft.lastGenerationContext) {
          setLastGenerationContext(draft.lastGenerationContext);
        }
      }
    }

    void loadDraft();
    // Only run on mount with the initial draft ID
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraftId]);

  // -----------------------------------------------------------------------
  // Load media library on mount
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!accountId) return;
    getCreateModalData()
      .then((data) => setLibraryItems(data.mediaAssets))
      .catch(() => { /* non-blocking — media picker still works without library */ });
  }, [accountId]);

  // -----------------------------------------------------------------------
  // Auto-save helper
  // -----------------------------------------------------------------------

  const buildDraftState = useCallback((targetStep?: number): DraftState => {
    // Compute legacy scheduledAt from first slot for backwards compat
    const firstSlot = selectedSlots[0];
    const legacyScheduledAt = firstSlot
      ? DateTime.fromISO(`${firstSlot.date}T${firstSlot.time}`, { zone: DEFAULT_TIMEZONE }).toISO() ?? undefined
      : undefined;

    // Compute legacy generatedCopy from first slot's copy
    const firstSlotCopy = generatedSlotCopies.find(sc => sc.status === 'ready' && sc.copy);
    const legacyGeneratedCopy = firstSlotCopy?.copy ?? undefined;

    return {
      step: targetStep ?? currentStep,
      contentType: form.getValues('contentType') as ContentType,
      brief: form.getValues() as unknown as Record<string, unknown>,
      selectedMediaIds: selectedMediaIds.length > 0 ? selectedMediaIds : undefined,
      // Multi-slot (canonical)
      selectedSlots: selectedSlots.length > 0 ? selectedSlots : undefined,
      generatedSlotCopies: generatedSlotCopies.length > 0 ? generatedSlotCopies : undefined,
      lastGenerationContext: lastGenerationContext ?? undefined,
      // Legacy single-slot (backwards compat)
      scheduledAt: legacyScheduledAt,
      generatedCopy: legacyGeneratedCopy,
    };
  }, [currentStep, form, selectedMediaIds, selectedSlots, generatedSlotCopies, lastGenerationContext]);

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  const handleContentTypeChange = useCallback(
    (type: ContentType) => {
      // Reset form to match new content type defaults while preserving shared fields
      const currentValues = form.getValues();
      const sharedFields = {
        title: currentValues.title,
        prompt: currentValues.prompt,
        platforms: type === 'story'
          ? (['facebook', 'instagram'] as const)
          : (currentValues.platforms ?? ['facebook', 'instagram', 'gbp']),
        tone: currentValues.tone,
        lengthPreference: currentValues.lengthPreference,
        includeHashtags: currentValues.includeHashtags,
        includeEmojis: currentValues.includeEmojis,
        ctaStyle: currentValues.ctaStyle,
        proofPoints: currentValues.proofPoints,
      };

      const typeDefaults: Record<ContentType, Partial<ContentBriefInput>> = {
        instant_post: { publishMode: 'now' },
        story: {},
        event: { eventName: '', eventDate: '', eventTime: '', venue: '' },
        promotion: { offerSummary: '', endDate: '' },
        weekly_recurring: { dayOfWeek: 1, time: '12:00', weeksAhead: 4 },
      };

      form.reset({
        contentType: type,
        ...sharedFields,
        ...typeDefaults[type],
      } as ContentBriefInput);
    },
    [form],
  );

  const goNext = useCallback(async () => {
    // Step 0 → 1 (Brief → Media): validate brief, create draft if needed
    if (currentStep === 0) {
      const valid = await form.trigger();
      if (!valid) return;

      if (!draftId) {
        setIsCreatingDraft(true);
        const result = await createDraft(form.getValues());
        setIsCreatingDraft(false);

        if (result.error || !result.id) {
          toast.error(result.error ?? 'Failed to create draft');
          return;
        }
        setDraftId(result.id);
        // Save full draft state immediately with target step
        save({
          step: 1,
          contentType: form.getValues('contentType') as ContentType,
          brief: form.getValues() as unknown as Record<string, unknown>,
          selectedMediaIds: selectedMediaIds.length > 0 ? selectedMediaIds : undefined,
          selectedSlots: selectedSlots.length > 0 ? selectedSlots : undefined,
        });
      } else {
        save(buildDraftState(1));
      }
    } else if (currentStep === 1) {
      // Step 1 → 2 (Media → Schedule): persist media attachments
      if (draftId) {
        const result = await attachMediaToContent(draftId, selectedMediaIds);
        if (result.error) {
          toast.error(`Failed to attach media: ${result.error}`);
        }
      }
      save(buildDraftState(2));
    } else if (currentStep === 2) {
      // Step 2 → 3 (Schedule → Generate): validate slots and sync form values
      const isInstantNow =
        form.getValues('contentType') === 'instant_post' &&
        (form.watch('publishMode') ?? 'now') === 'now';

      if (!isInstantNow) {
        // Validate at least one slot selected for schedule mode
        if (selectedSlots.length === 0) {
          toast.error('Select at least one schedule slot');
          return;
        }
      }

      // Sync form values for instant posts
      if (form.getValues('contentType') === 'instant_post') {
        const mode = selectedSlots.length > 0 ? 'schedule' : 'now';
        form.setValue('publishMode', mode);
        if (selectedSlots.length > 0) {
          const firstSlot = selectedSlots[0];
          const iso = DateTime.fromISO(`${firstSlot.date}T${firstSlot.time}`, { zone: DEFAULT_TIMEZONE }).toISO();
          form.setValue('scheduledFor', iso ?? undefined);
        }
      }
      save(buildDraftState(3));
    } else {
      save(buildDraftState());
    }

    setDirection(1);
    setCurrentStep((prev) => Math.min(prev + 1, STEP_LABELS.length - 1));
  }, [currentStep, draftId, form, save, buildDraftState, selectedMediaIds, selectedSlots, toast]);

  const goBack = useCallback(() => {
    save(buildDraftState());
    setDirection(-1);
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, [save, buildDraftState]);

  // -----------------------------------------------------------------------
  // Progress fraction
  // -----------------------------------------------------------------------

  const progressFraction = (currentStep + 1) / STEP_LABELS.length;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Breadcrumb + eyebrow */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p className="eyebrow">
          Create &middot; {CONTENT_TYPE_LABELS[form.getValues('contentType')] ?? 'Content'} &middot; Step {currentStep + 1} of {STEP_LABELS.length}
        </p>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--c-ink)',
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          What are <span style={{ color: 'var(--c-orange)' }}>we</span> saying today?
        </h1>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          backgroundColor: 'var(--c-paper-2)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressFraction * 100}%`,
            backgroundColor: 'var(--c-orange)',
            borderRadius: 2,
            transition: 'width 300ms ease',
          }}
        />
      </div>

      {/* Step labels */}
      <nav aria-label="Wizard progress">
        <ol
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {STEP_LABELS.map((label, index) => {
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;
            return (
              <li
                key={label}
                style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive
                    ? 'var(--c-orange)'
                    : isCompleted
                      ? 'var(--c-ink)'
                      : 'var(--c-ink-4)',
                  transition: 'color 200ms ease',
                }}
              >
                {label}
                {index < STEP_LABELS.length - 1 && (
                  <span style={{ color: 'var(--c-ink-4)', margin: '0 6px' }}>/</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Saving indicator */}
      {isSaving && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--c-ink-3)',
          }}
        >
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Saving...
        </div>
      )}

      {/* Step content with animations */}
      <div style={{ minHeight: 320, position: 'relative' }}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={STEP_ANIMATION}
            transition={STEP_ANIMATION.transition}
          >
            {currentStep === 0 && (
              <BriefStep
                form={form as unknown as import('react-hook-form').UseFormReturn<import('react-hook-form').FieldValues>}
                onContentTypeChange={handleContentTypeChange}
              />
            )}
            {currentStep === 1 && (
              <MediaStep
                contentId={draftId}
                selectedMediaIds={selectedMediaIds}
                onMediaChange={setSelectedMediaIds}
                accountId={accountId}
                campaignName={form.getValues('title')}
                libraryItems={libraryItems}
              />
            )}
            {currentStep === 2 && (
              <ScheduleStep
                contentId={draftId}
                contentBrief={form.getValues() as unknown as ContentBrief}
                publishMode={
                  watchedContentType === 'instant_post'
                    ? watchedPublishMode
                    : 'schedule'
                }
                selectedSlots={selectedSlots}
                onPublishModeChange={(mode) => {
                  form.setValue('publishMode', mode);
                  if (mode === 'now') {
                    setSelectedSlots([]);
                    form.setValue('scheduledFor', undefined);
                  }
                }}
                onSlotsChange={setSelectedSlots}
                accountId={accountId}
              />
            )}
            {currentStep === 3 && (
              <GenerateStep
                contentId={draftId}
                contentBrief={form.getValues() as unknown as ContentBrief}
                selectedSlots={selectedSlots}
                generatedSlotCopies={generatedSlotCopies}
                onSlotCopiesChange={setGeneratedSlotCopies}
                selectedMediaIds={selectedMediaIds}
                publishMode={watchedContentType === 'instant_post' ? watchedPublishMode : 'schedule'}
                isContextStale={
                  lastGenerationContext !== null && (
                    JSON.stringify([...lastGenerationContext.mediaIds].sort()) !== JSON.stringify([...selectedMediaIds].sort()) ||
                    JSON.stringify(lastGenerationContext.slots.map(s => `${s.date}:${s.time}`).sort()) !== JSON.stringify(selectedSlots.map(s => `${s.date}:${s.time}`).sort())
                  )
                }
                onGeneratedWithContext={(ctx: GenerationBatchContext) => setLastGenerationContext(ctx)}
                onSaveDraft={async () => {
                  if (!draftId) return;
                  const result = await saveDraft(draftId, buildDraftState());
                  if (result.error) {
                    toast.error('Failed to save draft', { description: result.error });
                  } else {
                    toast.success('Draft saved');
                    onClose();
                  }
                }}
                onScheduleAll={async () => {
                  if (!draftId) return;
                  const readySlotCopies = generatedSlotCopies
                    .filter(sc => sc.status === 'ready' && sc.copy !== null)
                    .map(sc => ({
                      slotKey: sc.slotKey,
                      scheduledAt: sc.scheduledAt!,
                      label: sc.label,
                      copy: sc.copy!,
                    }));
                  if (!readySlotCopies.length) return;
                  const result = await createScheduledBatch({
                    draftContentId: draftId,
                    contentType: form.getValues('contentType') as ContentType,
                    brief: form.getValues() as unknown as Record<string, unknown>,
                    selectedMediaIds,
                    slotCopies: readySlotCopies,
                    platforms: (form.getValues('platforms') as Platform[]),
                    mode: 'schedule',
                  });
                  if (result.error) {
                    toast.error('Failed to schedule', { description: result.error });
                  } else {
                    toast.success(`${readySlotCopies.length} post${readySlotCopies.length === 1 ? '' : 's'} scheduled`);
                    onClose();
                  }
                }}
                onQueueAll={async () => {
                  if (!draftId) return;
                  const readySlotCopies = generatedSlotCopies
                    .filter(sc => sc.status === 'ready' && sc.copy !== null)
                    .map(sc => ({
                      slotKey: sc.slotKey,
                      scheduledAt: sc.scheduledAt ?? new Date().toISOString(),
                      label: sc.label,
                      copy: sc.copy!,
                    }));
                  if (!readySlotCopies.length) return;
                  const result = await createScheduledBatch({
                    draftContentId: draftId,
                    contentType: form.getValues('contentType') as ContentType,
                    brief: form.getValues() as unknown as Record<string, unknown>,
                    selectedMediaIds,
                    slotCopies: readySlotCopies,
                    platforms: (form.getValues('platforms') as Platform[]),
                    mode: 'queue_now',
                  });
                  if (result.error) {
                    toast.error('Failed to queue', { description: result.error });
                  } else {
                    toast.success('Content queued for publishing');
                    onClose();
                  }
                }}
                isSubmitting={isSubmitting}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation buttons — sticky on mobile for reachability */}
      <div
        className="sticky bottom-0 z-10 -mx-4 px-4 sm:static sm:mx-0 sm:px-0"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--c-line)',
          paddingTop: 16,
          paddingBottom: 16,
          backgroundColor: 'var(--c-card)',
        }}
      >
        <Button
          type="button"
          variant="ghost"
          onClick={currentStep === 0 ? onClose : goBack}
          disabled={isCreatingDraft}
        >
          <ChevronLeft className="size-4 mr-1" aria-hidden="true" />
          {currentStep === 0 ? 'Cancel' : 'Back'}
        </Button>

        {currentStep < STEP_LABELS.length - 1 ? (
          <Button
            type="button"
            variant="amber"
            onClick={goNext}
            disabled={isCreatingDraft}
          >
            {isCreatingDraft ? (
              <Loader2 className="size-4 mr-1 animate-spin" aria-hidden="true" />
            ) : null}
            Next
          </Button>
        ) : null}
      </div>
    </div>
  );
}
