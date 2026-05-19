'use client';

import type { UseFormReturn, FieldValues } from 'react-hook-form';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface InstantPostFieldsProps {
  // Accept generic form -- the parent wizard guarantees correct field presence
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for instant posts.
 * Provides a publish-mode toggle (Post Now / Schedule) and a datetime picker
 * when "Schedule" is selected.
 */
export function InstantPostFields({ form }: InstantPostFieldsProps): React.JSX.Element {
  const { register, watch, formState: { errors } } = form;
  const publishMode = watch('publishMode');

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-foreground">Publish Options</legend>

      <div className="flex gap-4" role="radiogroup" aria-label="Publish mode">
        <label
          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
            publishMode === 'now'
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:border-ring/40'
          }`}
        >
          <input
            type="radio"
            value="now"
            className="sr-only"
            {...register('publishMode')}
          />
          Post Now
        </label>

        <label
          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
            publishMode === 'schedule'
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:border-ring/40'
          }`}
        >
          <input
            type="radio"
            value="schedule"
            className="sr-only"
            {...register('publishMode')}
          />
          Schedule
        </label>
      </div>
      {errors.publishMode && (
        <p className="text-sm text-destructive">{String(errors.publishMode.message)}</p>
      )}

      {publishMode === 'schedule' && (
        <div className="space-y-1.5">
          <Label htmlFor="scheduledFor">Schedule date and time</Label>
          <Input
            id="scheduledFor"
            type="datetime-local"
            {...register('scheduledFor')}
            aria-invalid={!!errors.scheduledFor}
          />
          {errors.scheduledFor && (
            <p className="text-sm text-destructive">{String(errors.scheduledFor.message)}</p>
          )}
        </div>
      )}
    </fieldset>
  );
}
