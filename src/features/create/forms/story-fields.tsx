'use client';

import type { UseFormReturn, FieldValues } from 'react-hook-form';

interface StoryFieldsProps {
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for stories.
 * Stories are limited to Facebook and Instagram.
 * Platform selection is handled by the parent BriefStep with restricted options.
 */
export function StoryFields({ form }: StoryFieldsProps): React.JSX.Element {
  const { formState: { errors } } = form;

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>Story Settings</legend>

      <div
        className="rounded-lg p-3 text-sm"
        style={{ background: 'var(--c-orange-soft)', border: '1px solid var(--c-orange)', borderRadius: 'var(--r-lg)', color: 'var(--c-ink)' }}
        role="note"
      >
        Stories are available on Facebook and Instagram only.
      </div>

      {errors.platforms && (
        <p className="text-sm text-destructive">{String(errors.platforms.message)}</p>
      )}
    </fieldset>
  );
}
