'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';

/** Disabled while the POST runs, so a double click cannot spend the one-time link twice. */
export function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="cta" size="xl" full disabled={pending}>
      {pending ? 'Confirming...' : 'Confirm and continue'}
    </Button>
  );
}
