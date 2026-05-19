'use client';

import { ImagePlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface MediaStepProps {
  selectedMediaIds: string[];
  onMediaChange: (ids: string[]) => void;
}

/**
 * Step 3: Media attachment.
 *
 * Placeholder component showing selected media thumbnails and an "Open Library"
 * button. Will be wired to the media library in Plan 06.
 */
export function MediaStep({
  selectedMediaIds,
  onMediaChange,
}: MediaStepProps): React.JSX.Element {
  function handleRemove(id: string): void {
    onMediaChange(selectedMediaIds.filter((mid) => mid !== id));
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">Attach Media</h3>
        <p className="text-sm text-muted-foreground">
          Add images or graphics to your content. You can select from your media library.
        </p>
      </div>

      {/* Selected media grid */}
      {selectedMediaIds.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {selectedMediaIds.map((id) => (
            <div
              key={id}
              className="group relative aspect-square rounded-lg border border-border bg-muted"
            >
              {/* Placeholder thumbnail -- actual images wired in Plan 06 */}
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {id.slice(0, 8)}
              </div>
              <button
                type="button"
                className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                onClick={() => handleRemove(id)}
                aria-label={`Remove media ${id.slice(0, 8)}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Open library button */}
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border py-8">
        <div className="rounded-full bg-muted p-3">
          <ImagePlus className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">
          {selectedMediaIds.length > 0
            ? `${selectedMediaIds.length} item${selectedMediaIds.length === 1 ? '' : 's'} selected`
            : 'No media attached yet'}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            // Placeholder: wired to media library in Plan 06
          }}
        >
          <ImagePlus className="size-4 mr-1.5" aria-hidden="true" />
          Open Library
        </Button>
      </div>
    </div>
  );
}
