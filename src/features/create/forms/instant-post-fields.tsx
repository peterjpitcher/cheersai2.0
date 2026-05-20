'use client';

import type { UseFormReturn, FieldValues } from 'react-hook-form';

interface InstantPostFieldsProps {
  // Accept generic form -- the parent wizard guarantees correct field presence
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for instant posts.
 * Publish mode defaults to 'now'; scheduling is handled by the Schedule step.
 */
export function InstantPostFields({ form }: InstantPostFieldsProps): React.JSX.Element {
  void form;
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-foreground">Publish Options</legend>
      <p className="text-sm text-muted-foreground">
        Choose when to publish in the Schedule step. By default, your post will be queued for immediate publishing.
      </p>
    </fieldset>
  );
}
