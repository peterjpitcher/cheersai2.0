'use client';

import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MediaFiltersProps {
  onSearchChange: (query: string) => void;
  onTagFilter: (tags: string[]) => void;
  availableTags: string[];
}

// ---------------------------------------------------------------------------
// MediaFilters
// ---------------------------------------------------------------------------

/**
 * Search input (debounced 300ms) and horizontal tag filter chips
 * for the media library (D-13: search by tag or campaign name).
 */
export function MediaFilters({
  onSearchChange,
  onTagFilter,
  availableTags,
}: MediaFiltersProps): React.JSX.Element {
  const [searchValue, setSearchValue] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search callback
  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchValue(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        onSearchChange(value.trim());
      }, 300);
    },
    [onSearchChange],
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Toggle tag filter
  const toggleTag = useCallback(
    (tag: string) => {
      setActiveTags((prev) => {
        const next = prev.includes(tag)
          ? prev.filter((t) => t !== tag)
          : [...prev, tag];
        onTagFilter(next);
        return next;
      });
    },
    [onTagFilter],
  );

  // Remove a specific active tag
  const removeTag = useCallback(
    (tag: string) => {
      setActiveTags((prev) => {
        const next = prev.filter((t) => t !== tag);
        onTagFilter(next);
        return next;
      });
    },
    [onTagFilter],
  );

  // Clear all filters
  const clearAll = useCallback(() => {
    setSearchValue('');
    setActiveTags([]);
    onSearchChange('');
    onTagFilter([]);
  }, [onSearchChange, onTagFilter]);

  const hasActiveFilters = searchValue.trim().length > 0 || activeTags.length > 0;

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--c-ink-3)]" />
        <Input
          type="text"
          placeholder="Search by file name or tag..."
          value={searchValue}
          onChange={(e) => handleSearchInput(e.target.value)}
          className="pl-9"
        />
        {searchValue && (
          <button
            type="button"
            onClick={() => handleSearchInput('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--c-ink-3)] hover:text-[var(--c-ink)]"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tag filter chips */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
          {availableTags.map((tag) => {
            const isActive = activeTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={clsx(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition',
                  isActive
                    ? 'border-[var(--c-orange)] bg-[var(--c-orange-soft)] text-[var(--c-orange)]'
                    : 'border-[var(--c-line)] bg-[var(--c-card)] text-[var(--c-ink-3)] hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)]',
                )}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Active filters display */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[var(--c-ink-3)]">Active:</span>
          {activeTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--c-orange-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c-orange)]"
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-[var(--c-orange)]/20"
                aria-label={`Remove ${tag} filter`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-[var(--c-ink-3)] underline hover:text-[var(--c-ink)]"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
