'use client';

import { useEffect } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';
import {
  Zap,
  Film,
  CalendarDays,
  Tag,
  Repeat,
  ChevronDown,
} from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PlatformBadge } from '@/components/ui/platform-badge';
// Content types used by the brief step (via FieldValues generic form)
import type { ContentType, Platform } from '@/types/content';

import { InstantPostFields } from '@/features/create/forms/instant-post-fields';
import { StoryFields } from '@/features/create/forms/story-fields';
import { EventFields } from '@/features/create/forms/event-fields';
import { PromotionFields } from '@/features/create/forms/promotion-fields';
import { WeeklyRecurringFields } from '@/features/create/forms/weekly-recurring-fields';

// ---------------------------------------------------------------------------
// Content type definitions for the picker (D-02)
// ---------------------------------------------------------------------------

const CONTENT_TYPES: {
  type: ContentType;
  icon: typeof Zap;
  label: string;
  description: string;
}[] = [
  { type: 'instant_post', icon: Zap, label: 'Instant Post', description: 'Quick single post' },
  { type: 'story', icon: Film, label: 'Story', description: 'Instagram/Facebook story' },
  { type: 'event', icon: CalendarDays, label: 'Event', description: 'Promote an upcoming event' },
  { type: 'promotion', icon: Tag, label: 'Promotion', description: 'Special offer or deal' },
  { type: 'weekly_recurring', icon: Repeat, label: 'Weekly Recurring', description: 'Auto-publish weekly' },
];

const TONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'friendly_warm', label: 'Friendly & Warm' },
  { value: 'professional', label: 'Professional' },
  { value: 'playful', label: 'Playful' },
  { value: 'sophisticated', label: 'Sophisticated' },
  { value: 'community_focused', label: 'Community Focused' },
];

const ALL_PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'gbp', label: 'Google' },
];

const DEFAULT_CAMPAIGN_PLACEMENTS: Array<'feed' | 'story'> = ['feed'];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BriefStepProps {
  form: UseFormReturn<FieldValues>;
  onContentTypeChange: (type: ContentType) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Step 1: Content type picker, common fields, platform selection, and
 * progressive disclosure fine-tune controls (D-04).
 */
export function BriefStep({ form, onContentTypeChange }: BriefStepProps): React.JSX.Element {
  const { register, watch, setValue, formState: { errors } } = form;
  const contentType = watch('contentType');
  const selectedPlatforms = watch('platforms') ?? [];
  const watchedPlacements = watch('placements') as Array<'feed' | 'story'> | undefined;
  const selectedPlacements = watchedPlacements ?? DEFAULT_CAMPAIGN_PLACEMENTS;
  const isStory = contentType === 'story';
  const isEventCampaign = contentType === 'event';
  const hasCampaignPlacements = contentType === 'event' || contentType === 'promotion';
  const placementKey = selectedPlacements.join('|');

  const availablePlatforms = isStory
    ? ALL_PLATFORMS.filter((p) => p.value !== 'gbp')
    : ALL_PLATFORMS;

  useEffect(() => {
    if (!isEventCampaign) return;

    const current = placementKey
      .split('|')
      .filter((value): value is 'feed' | 'story' => value === 'feed' || value === 'story');
    if (current.length === 1 && (current[0] === 'feed' || current[0] === 'story')) {
      return;
    }

    setValue('placements', [current.find((value) => value === 'story' || value === 'feed') ?? 'feed'], {
      shouldValidate: true,
    });
  }, [isEventCampaign, placementKey, setValue]);

  function handlePlatformToggle(platform: Platform): void {
    const current = selectedPlatforms as Platform[];
    const updated = current.includes(platform)
      ? current.filter((p) => p !== platform)
      : [...current, platform];
    setValue('platforms', updated, { shouldValidate: true });
  }

  function handlePlacementToggle(placement: 'feed' | 'story'): void {
    if (isEventCampaign) {
      setValue('placements', [placement], { shouldValidate: true });
      return;
    }

    const current = selectedPlacements as Array<'feed' | 'story'>;
    const updated = current.includes(placement)
      ? current.filter((value) => value !== placement)
      : [...current, placement];
    setValue('placements', updated, { shouldValidate: true });
  }

  return (
    <div className="space-y-6">
      {/* Content type picker (D-02) */}
      <fieldset>
        <legend className="text-sm font-medium text-foreground mb-3">What would you like to create?</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CONTENT_TYPES.map(({ type, icon: Icon, label, description }) => {
            const isSelected = contentType === type;
            return (
              <button
                key={type}
                type="button"
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-card hover:border-ring/40 hover:bg-muted/50'
                }`}
                onClick={() => onContentTypeChange(type)}
                aria-pressed={isSelected}
              >
                <Icon
                  className={`size-6 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                  aria-hidden="true"
                />
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Common fields */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            placeholder="Give your content a title"
            {...register('title')}
            aria-invalid={!!errors.title}
          />
          {errors.title && (
            <p className="text-sm text-destructive">{String(errors.title.message)}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prompt">Brief / prompt</Label>
          <textarea
            id="prompt"
            rows={3}
            className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150 hover:border-ring/40 resize-none"
            placeholder="Describe what you want the AI to write about..."
            {...register('prompt')}
          />
        </div>
      </div>

      {/* Platform selection */}
      <fieldset>
        <legend className="text-sm font-medium text-foreground mb-2">
          Platforms <span className="text-destructive">*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {availablePlatforms.map(({ value, label }) => {
            const isChecked = (selectedPlatforms as Platform[]).includes(value);
            return (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  isChecked
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:border-ring/40'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isChecked}
                  onChange={() => handlePlatformToggle(value)}
                />
                <PlatformBadge platform={value} />
                <span className="text-foreground">{label}</span>
              </label>
            );
          })}
        </div>
      {errors.platforms && (
        <p className="mt-1 text-sm text-destructive">{String(errors.platforms.message)}</p>
      )}
      </fieldset>

      {hasCampaignPlacements && (
        <fieldset>
          <legend className="text-sm font-medium text-foreground mb-2">
            {isEventCampaign ? 'Placement' : 'Placements'} <span className="text-destructive">*</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {(['feed', 'story'] as const).map((placement) => {
              const isChecked = (selectedPlacements as Array<'feed' | 'story'>).includes(placement);
              const inputType = isEventCampaign ? 'radio' : 'checkbox';
              return (
                <label
                  key={placement}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    isChecked
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-ring/40'
                  }`}
                >
                  <input
                    type={inputType}
                    name={isEventCampaign ? 'event-placement' : undefined}
                    className="sr-only"
                    checked={isChecked}
                    onChange={() => handlePlacementToggle(placement)}
                  />
                  <span className="text-foreground">
                    {isEventCampaign
                      ? placement === 'story'
                        ? 'Story'
                        : 'Post'
                      : placement === 'story'
                        ? 'Stories'
                        : 'Feed'}
                  </span>
                </label>
              );
            })}
          </div>
          {errors.placements && (
            <p className="mt-1 text-sm text-destructive">{String(errors.placements.message)}</p>
          )}
        </fieldset>
      )}

      {/* Type-specific fields */}
      {contentType === 'instant_post' && <InstantPostFields form={form} />}
      {contentType === 'story' && <StoryFields form={form} />}
      {contentType === 'event' && <EventFields form={form} />}
      {contentType === 'promotion' && <PromotionFields form={form} />}
      {contentType === 'weekly_recurring' && <WeeklyRecurringFields form={form} />}

      {/* Advanced Options (D-04 progressive disclosure) */}
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground select-none">
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          Advanced Options
        </summary>
        <div className="mt-4 space-y-4 rounded-lg border border-border bg-muted/30 p-4">
          {/* Tone */}
          <div className="space-y-1.5">
            <Label htmlFor="tone">Tone</Label>
            <select
              id="tone"
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150"
              {...register('tone')}
            >
              {TONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Length preference */}
          <div className="space-y-1.5">
            <Label>Length</Label>
            <div className="flex gap-2">
              {(['short', 'standard', 'detailed'] as const).map((len) => {
                const current = watch('lengthPreference');
                return (
                  <button
                    key={len}
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                      current === len
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:border-ring/40'
                    }`}
                    onClick={() => setValue('lengthPreference', len)}
                  >
                    {len}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="rounded accent-primary"
                {...register('includeHashtags')}
              />
              Include hashtags
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="rounded accent-primary"
                {...register('includeEmojis')}
              />
              Include emojis
            </label>
          </div>

          {/* CTA style */}
          <div className="space-y-1.5">
            <Label htmlFor="ctaStyle">CTA style</Label>
            <select
              id="ctaStyle"
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150"
              {...register('ctaStyle')}
            >
              <option value="default">Default</option>
              <option value="direct">Direct</option>
              <option value="urgent">Urgent</option>
              <option value="none">None</option>
            </select>
          </div>

          {/* Proof points */}
          <div className="space-y-1.5">
            <Label htmlFor="proofPoints">Proof points</Label>
            <textarea
              id="proofPoints"
              rows={2}
              className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150 resize-none"
              placeholder="Awards, reviews, facts to include (one per line)"
              onChange={(e) => {
                const points = e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean);
                setValue('proofPoints', points);
              }}
              defaultValue={(watch('proofPoints') ?? []).join('\n')}
            />
          </div>
        </div>
      </details>
    </div>
  );
}
