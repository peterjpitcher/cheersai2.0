'use client';

import type { UseFormReturn, FieldValues } from 'react-hook-form';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const;

interface WeeklyRecurringFieldsProps {
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for weekly recurring content.
 * Provides day-of-week selector, time picker, and weeks-ahead slider.
 */
const PLACEMENTS = [
  { value: 'feed', label: 'Feed post' },
  { value: 'story', label: 'Story' },
] as const;

export function WeeklyRecurringFields({ form }: WeeklyRecurringFieldsProps): React.JSX.Element {
  const { register, watch, setValue, formState: { errors } } = form;
  const selectedDay = watch('dayOfWeek') as number | undefined;
  const weeksAhead = (watch('weeksAhead') as number) ?? 4;
  const placement = (watch('placement') as 'feed' | 'story') ?? 'feed';

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
              onClick={() => setValue('placement', option.value, { shouldValidate: true })}
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
          Day of week <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Day of week">
          {DAYS.map((day) => (
            <button
              key={day.value}
              type="button"
              role="radio"
              aria-checked={selectedDay === day.value}
              className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                selectedDay === day.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:border-ring/40 hover:bg-muted'
              }`}
              onClick={() => setValue('dayOfWeek', day.value, { shouldValidate: true })}
            >
              {day.label}
            </button>
          ))}
        </div>
        {errors.dayOfWeek && (
          <p className="text-sm text-destructive">{String(errors.dayOfWeek.message)}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurringTime">
          Time <span className="text-destructive">*</span>
        </Label>
        <Input
          id="recurringTime"
          type="time"
          {...register('time')}
          aria-invalid={!!errors.time}
        />
        {errors.time && (
          <p className="text-sm text-destructive">{String(errors.time.message)}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="weeksAhead">Number of posts</Label>
          <span className="text-sm font-medium text-foreground">
            {weeksAhead} {weeksAhead === 1 ? 'post' : 'posts'}
          </span>
        </div>
        <input
          id="weeksAhead"
          type="range"
          min={1}
          max={12}
          step={1}
          className="w-full accent-primary"
          {...register('weeksAhead', { valueAsNumber: true })}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1 post</span>
          <span>12 posts</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Repeats weekly at the chosen time — no fixed end date.
        </p>
      </div>
    </fieldset>
  );
}
