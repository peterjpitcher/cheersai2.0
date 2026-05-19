'use client';

import type { UseFormReturn, FieldValues } from 'react-hook-form';

interface StoryFieldsProps {
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for stories.
 * Stories are limited to Facebook and Instagram (no GBP support).
 * Platform selection is handled by the parent BriefStep with restricted options.
 */
export function StoryFields({ form }: StoryFieldsProps): React.JSX.Element {
  const { formState: { errors } } = form;

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-foreground">Story Settings</legend>

      <div
        className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
        role="note"
      >
        Stories are available on Facebook and Instagram only. Google Business Profile does
        not support stories.
      </div>

      {errors.platforms && (
        <p className="text-sm text-destructive">{String(errors.platforms.message)}</p>
      )}
    </fieldset>
  );
}
