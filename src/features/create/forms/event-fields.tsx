'use client';

import type { UseFormReturn, FieldValues } from 'react-hook-form';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface EventFieldsProps {
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for event content.
 * Captures event name, date, time, optional end date, and venue.
 */
export function EventFields({ form }: EventFieldsProps): React.JSX.Element {
  const { register, formState: { errors } } = form;

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-foreground">Event Details</legend>

      <div className="space-y-1.5">
        <Label htmlFor="eventName">
          Event name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="eventName"
          placeholder="e.g. Friday Live Music"
          {...register('eventName')}
          aria-invalid={!!errors.eventName}
        />
        {errors.eventName && (
          <p className="text-sm text-destructive">{String(errors.eventName.message)}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="eventDate">
            Event date <span className="text-destructive">*</span>
          </Label>
          <Input
            id="eventDate"
            type="date"
            {...register('eventDate')}
            aria-invalid={!!errors.eventDate}
          />
          {errors.eventDate && (
            <p className="text-sm text-destructive">{String(errors.eventDate.message)}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="eventTime">
            Event time <span className="text-destructive">*</span>
          </Label>
          <Input
            id="eventTime"
            type="time"
            {...register('eventTime')}
            aria-invalid={!!errors.eventTime}
          />
          {errors.eventTime && (
            <p className="text-sm text-destructive">{String(errors.eventTime.message)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="eventEndDate">End date (optional)</Label>
          <Input
            id="eventEndDate"
            type="date"
            {...register('eventEndDate')}
            aria-invalid={!!errors.eventEndDate}
          />
          {errors.eventEndDate && (
            <p className="text-sm text-destructive">{String(errors.eventEndDate.message)}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="venue">Venue (optional)</Label>
          <Input
            id="venue"
            placeholder="e.g. The Anchor, Shepperton"
            {...register('venue')}
            aria-invalid={!!errors.venue}
          />
          {errors.venue && (
            <p className="text-sm text-destructive">{String(errors.venue.message)}</p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
