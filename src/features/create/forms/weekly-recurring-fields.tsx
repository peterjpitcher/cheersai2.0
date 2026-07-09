'use client';

import { useMemo } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';
import { DateTime } from 'luxon';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DEFAULT_TIMEZONE, WEEKLY_MAX_OCCURRENCES } from '@/lib/constants';
import { buildWeeklyMultiDaySuggestions } from '@/features/create/schedule/suggestion-utils';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const;

const PLACEMENTS = [
  { value: 'feed', label: 'Feed post' },
  { value: 'story', label: 'Story' },
] as const;

const MAX_OCCURRENCES = WEEKLY_MAX_OCCURRENCES;

interface WeeklyRecurringFieldsProps {
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for weekly recurring content: post type, multi-select
 * days of the week, time, and a calendar end date. Shows a live count of how
 * many posts the current settings produce and flags 0 or over the cap.
 */
export function WeeklyRecurringFields({ form }: WeeklyRecurringFieldsProps): React.JSX.Element {
  const { register, watch, setValue, formState: { errors } } = form;
  const watchedDays = watch('daysOfWeek') as number[] | undefined;
  // Memoise so the fallback empty array keeps a stable reference across renders
  // (a bare `?? []` allocates a new array each render, which breaks the
  // occurrenceCount useMemo below under React Compiler's memoization rules).
  const selectedDays = useMemo(() => watchedDays ?? [], [watchedDays]);
  const time = (watch('time') as string) ?? '12:00';
  const endDate = (watch('endDate') as string) ?? '';
  const placement = (watch('placement') as 'feed' | 'story') ?? 'feed';
  const ctaLink = (watch('ctaLinks') as { facebook?: string } | undefined)?.facebook ?? '';
  const ctaLabel = (watch('ctaLabel') as string | undefined) ?? '';
  const isStory = placement === 'story';

  const setPlacement = (value: 'feed' | 'story') => {
    setValue('placement', value, { shouldValidate: true });
    if (value === 'story') {
      // Stories can't carry a link (no composed body, feed-only bio card).
      setValue('ctaLinks', undefined, { shouldValidate: true });
      setValue('ctaLabel', undefined, { shouldValidate: true });
    }
  };

  const setCtaLink = (raw: string) => {
    const url = raw.trim();
    // Map to both platforms: Facebook appends the URL to copy; Instagram gets the
    // "link in bio" line (the bio card holds the actual link).
    setValue('ctaLinks', url ? { facebook: url, instagram: url } : undefined, {
      shouldValidate: true,
    });
  };

  const setCtaLabel = (raw: string) => {
    const label = raw.trim();
    setValue('ctaLabel', label ? label : undefined, { shouldValidate: true });
  };

  const today = DateTime.now().setZone(DEFAULT_TIMEZONE).toFormat('yyyy-MM-dd');

  const toggleDay = (day: number) => {
    const next = selectedDays.includes(day)
      ? selectedDays.filter((d) => d !== day)
      : [...selectedDays, day];
    setValue('daysOfWeek', next, { shouldValidate: true });
  };

  const occurrenceCount = useMemo(() => {
    if (!selectedDays.length || !endDate) return 0;
    return buildWeeklyMultiDaySuggestions({
      startDate: today,
      daysOfWeek: selectedDays,
      time,
      endDate,
      timezone: DEFAULT_TIMEZONE,
    }).length;
  }, [selectedDays, time, endDate, today]);

  const countTone =
    occurrenceCount === 0 || occurrenceCount > MAX_OCCURRENCES
      ? 'text-destructive'
      : 'text-muted-foreground';

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-foreground">Recurring Schedule</legend>

      <div className="space-y-1.5">
        <Label>Post type</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Post type">
          {PLACEMENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={placement === option.value}
              className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                placement === option.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:border-ring/40 hover:bg-muted'
              }`}
              onClick={() => setPlacement(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Stories post to Facebook and Instagram only and need one image.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>
          Days of week <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Days of week">
          {DAYS.map((day) => {
            const active = selectedDays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                role="checkbox"
                aria-checked={active}
                className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-ring/40 hover:bg-muted'
                }`}
                onClick={() => toggleDay(day.value)}
              >
                {day.label}
              </button>
            );
          })}
        </div>
        {errors.daysOfWeek && (
          <p className="text-sm text-destructive">{String(errors.daysOfWeek.message)}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurringTime">
          Time <span className="text-destructive">*</span>
        </Label>
        <Input id="recurringTime" type="time" {...register('time')} aria-invalid={!!errors.time} />
        {errors.time && <p className="text-sm text-destructive">{String(errors.time.message)}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="endDate">
          End date <span className="text-destructive">*</span>
        </Label>
        <Input
          id="endDate"
          type="date"
          min={today}
          {...register('endDate')}
          aria-invalid={!!errors.endDate}
        />
        {errors.endDate && <p className="text-sm text-destructive">{String(errors.endDate.message)}</p>}
        <p className={`text-xs ${countTone}`}>
          {occurrenceCount === 0
            ? 'Pick at least one day and an end date to schedule a post.'
            : occurrenceCount > MAX_OCCURRENCES
              ? `${occurrenceCount} posts — that’s over the limit of ${MAX_OCCURRENCES}. Shorten the range or remove a day.`
              : `${occurrenceCount} ${occurrenceCount === 1 ? 'post' : 'posts'} will be scheduled, one per selected day each week.`}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ctaLink">Campaign link (optional)</Label>
        <Input
          id="ctaLink"
          type="url"
          inputMode="url"
          placeholder="https://your-booking-link.com"
          value={ctaLink}
          disabled={isStory}
          onChange={(e) => setCtaLink(e.target.value)}
          aria-invalid={!!(errors.ctaLinks as unknown)}
        />
        {isStory ? (
          <p className="text-xs text-muted-foreground">
            Links aren’t available on story campaigns — switch to Feed to use one.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Added to your Facebook posts and shown on your link-in-bio page for the whole run.
          </p>
        )}
        {errors.ctaLinks && (
          <p className="text-sm text-destructive">Enter a valid URL (including https://).</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ctaLabel">Button text (optional)</Label>
        <Input
          id="ctaLabel"
          type="text"
          maxLength={40}
          placeholder="Book a table"
          value={ctaLabel}
          disabled={isStory || !ctaLink}
          onChange={(e) => setCtaLabel(e.target.value)}
          aria-invalid={!!errors.ctaLabel}
        />
        <p className="text-xs text-muted-foreground">
          {isStory
            ? 'Not available on story campaigns.'
            : !ctaLink
              ? 'Add a campaign link first to customise its button text.'
              : 'Shown on the Facebook call-to-action and the link-in-bio button. Defaults to “Book a table”.'}
        </p>
        {errors.ctaLabel && (
          <p className="text-sm text-destructive">{String(errors.ctaLabel.message)}</p>
        )}
      </div>
    </fieldset>
  );
}
