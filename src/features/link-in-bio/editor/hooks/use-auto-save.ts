'use client';

/**
 * Auto-save hook for the link-in-bio editor (D-06).
 * Debounces changes and persists draft state. Uses JSON.stringify comparison
 * to skip no-op saves when data hasn't actually changed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveReturn {
  saveState: SaveState;
  lastSavedAt: Date | null;
}

export function useAutoSave<T>(
  data: T,
  saveFn: (data: T) => Promise<void>,
  debounceMs = 2000,
): UseAutoSaveReturn {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedJsonRef = useRef<string>('');
  const saveFnRef = useRef(saveFn);
  const isMountedRef = useRef(true);

  useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  const doSave = useCallback(async (payload: T) => {
    const json = JSON.stringify(payload);
    if (json === lastSavedJsonRef.current) {
      return; // No actual change -- skip save
    }

    setSaveState('saving');

    try {
      await saveFnRef.current(payload);
      if (!isMountedRef.current) return;

      lastSavedJsonRef.current = json;
      setSaveState('saved');
      setLastSavedAt(new Date());

      // Auto-clear 'saved' to 'idle' after 3 seconds
      if (savedClearRef.current) {
        clearTimeout(savedClearRef.current);
      }
      savedClearRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setSaveState('idle');
        }
      }, 3000);
    } catch {
      if (isMountedRef.current) {
        setSaveState('error');
      }
    }
  }, []);

  useEffect(() => {
    // Skip the initial mount -- only save on subsequent changes
    if (lastSavedJsonRef.current === '') {
      lastSavedJsonRef.current = JSON.stringify(data);
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      void doSave(data);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [data, debounceMs, doSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (savedClearRef.current) clearTimeout(savedClearRef.current);
    };
  }, []);

  return { saveState, lastSavedAt };
}
