'use client';

/**
 * Auto-save hook for the create wizard (D-03).
 *
 * Deduplicates saves by comparing JSON serialization against the last saved
 * state. Skips if contentId is null (draft not yet persisted to DB).
 * Returns `isSaving` indicator for subtle UI feedback and `lastError` for
 * error display.
 */

import { useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';

import { saveDraft } from '@/app/actions/content';
import type { DraftState } from '@/types/content';

export function useAutoSaveDraft(contentId: string | null): {
  save: (data: DraftState) => void;
  isSaving: boolean;
  lastError: string | null;
} {
  const lastSavedRef = useRef<string>('');

  const mutation = useMutation({
    mutationFn: (data: DraftState) => saveDraft(contentId!, data),
    // Silent save -- no onSuccess toast needed
  });

  const save = useCallback(
    (data: DraftState) => {
      if (!contentId) return; // Not yet persisted
      const serialized = JSON.stringify(data);
      if (serialized === lastSavedRef.current) return; // No change
      lastSavedRef.current = serialized;
      mutation.mutate(data);
    },
    [contentId, mutation],
  );

  return {
    save,
    isSaving: mutation.isPending,
    lastError: mutation.error?.message ?? null,
  };
}
