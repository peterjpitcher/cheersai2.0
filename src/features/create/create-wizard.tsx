'use client';

import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import { useAutoSaveDraft } from '@/lib/content/draft-autosave';
import { createDraft, getDraft } from '@/app/actions/content';
import { attachMediaToContent } from '@/app/actions/media';
import { contentBriefSchema } from '@/features/create/schemas/content-schemas';
import type { ContentBrief, ContentBriefInput } from '@/features/create/schemas/content-schemas';
import type { ContentType, DraftState, PlatformCopy } from '@/types/content';

import { BriefStep } from '@/features/create/steps/brief-step';
import { GenerateStep } from '@/features/create/steps/generate-step';
import { MediaStep } from '@/features/create/steps/media-step';
import { ScheduleStep } from '@/features/create/steps/schedule-step';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_LABELS = ['Brief', 'Generate', 'Media', 'Schedule'] as const;

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
 * 4-step create wizard: Brief -> Generate -> Media -> Schedule.
 *
 * Manages step navigation, form state via React Hook Form + Zod, auto-save on
 * step transitions (D-03), and draft resume via initialDraftId.
 * Generate step wired to AI generation actions. Media step wired to MediaPicker.
 */
export function CreateWizard({ initialDraftId, accountId, onClose }: CreateWizardProps): React.JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState<PlatformCopy | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
        if (draft.generatedCopy) setGeneratedCopy(draft.generatedCopy);
        if (draft.selectedMediaIds) setSelectedMediaIds(draft.selectedMediaIds);
      }
    }

    void loadDraft();
    // Only run on mount with the initial draft ID
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraftId]);

  // -----------------------------------------------------------------------
  // Auto-save helper
  // -----------------------------------------------------------------------

  const buildDraftState = useCallback((): DraftState => ({
    step: currentStep,
    contentType: form.getValues('contentType') as ContentType,
    brief: form.getValues() as unknown as Record<string, unknown>,
    generatedCopy: generatedCopy ?? undefined,
    selectedMediaIds: selectedMediaIds.length > 0 ? selectedMediaIds : undefined,
  }), [currentStep, form, generatedCopy, selectedMediaIds]);

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
    // Step 0 -> 1: validate brief and create draft if needed
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
      } else {
        save(buildDraftState());
      }
    } else if (currentStep === 2) {
      // Step 2 -> 3: persist media attachments before moving to schedule
      if (draftId && selectedMediaIds.length > 0) {
        const result = await attachMediaToContent(draftId, selectedMediaIds);
        if (result.error) {
          toast.error(`Failed to attach media: ${result.error}`);
        }
      }
      save(buildDraftState());
    } else {
      // Auto-save on every step transition
      save(buildDraftState());
    }

    setDirection(1);
    setCurrentStep((prev) => Math.min(prev + 1, STEP_LABELS.length - 1));
  }, [currentStep, draftId, form, save, buildDraftState, selectedMediaIds, toast]);

  const goBack = useCallback(() => {
    save(buildDraftState());
    setDirection(-1);
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, [save, buildDraftState]);

  const handleConfirm = useCallback(async () => {
    setIsSubmitting(true);
    save(buildDraftState());
    // Final confirmation handled by the schedule step's onConfirm
    // Will be wired to the publish pipeline in Phase 4
    setIsSubmitting(false);
    onClose();
  }, [save, buildDraftState, onClose]);

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
          Create &middot; Instant post &middot; Step {currentStep + 1} of {STEP_LABELS.length}
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
              <GenerateStep
                contentId={draftId}
                contentBrief={form.getValues() as unknown as ContentBrief}
                generatedCopy={generatedCopy}
                onCopyChange={setGeneratedCopy}
                warnings={aiWarnings}
                onWarningsChange={setAiWarnings}
              />
            )}
            {currentStep === 2 && (
              <MediaStep
                contentId={draftId}
                selectedMediaIds={selectedMediaIds}
                onMediaChange={setSelectedMediaIds}
                accountId={accountId}
                campaignName={form.getValues('title')}
              />
            )}
            {currentStep === 3 && (
              <ScheduleStep
                contentId={draftId}
                contentBrief={form.getValues() as unknown as ContentBrief}
                generatedCopy={generatedCopy}
                selectedMediaIds={selectedMediaIds}
                onConfirm={handleConfirm}
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
            {currentStep === 0 ? 'Draft posts' : 'Next'}
            <Sparkles className="size-4 ml-1" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
