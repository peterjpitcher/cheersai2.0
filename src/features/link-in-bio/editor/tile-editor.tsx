'use client';
'use no memo';

/**
 * Tile editor form for link-in-bio tiles.
 * Shows different fields depending on tile type.
 * Validates with tileSchema before saving.
 */

import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';

import { cn } from '@/lib/utils';
import { tileSchema } from '@/lib/link-in-bio/validation';
import type { LinkInBioTile, TileType, UpsertLinkInBioTileInput } from '@/lib/link-in-bio/types';

interface TileEditorProps {
  tile: LinkInBioTile | null;
  onSave: (input: UpsertLinkInBioTileInput) => void;
  onCancel: () => void;
}

const TILE_TYPES: { value: TileType; label: string; description: string }[] = [
  { value: 'link', label: 'Link', description: 'External URL with title and CTA' },
  { value: 'media', label: 'Media', description: 'Image tile with optional link' },
  { value: 'embed_map', label: 'Google Maps', description: 'Embedded map location' },
  { value: 'embed_menu', label: 'Menu PDF', description: 'Link to your menu' },
  { value: 'embed_social', label: 'Social Post', description: 'Featured social post' },
  { value: 'embed_events', label: 'Events', description: 'Upcoming events list' },
];

interface TileFormValues {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaUrl: string;
  tileType: TileType;
  embedPlaceId: string;
  embedQuery: string;
  embedPdfUrl: string;
  embedPdfTitle: string;
  embedPlatform: 'instagram' | 'facebook';
  embedPostUrl: string;
  embedMaxItems: number;
}

export function TileEditor({ tile, onSave, onCancel }: TileEditorProps) {
  const [validationError, setValidationError] = useState<string | null>(null);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<TileFormValues>({
    defaultValues: {
      title: tile?.title ?? '',
      subtitle: tile?.subtitle ?? '',
      ctaLabel: tile?.ctaLabel ?? 'Visit',
      ctaUrl: tile?.ctaUrl ?? '',
      tileType: tile?.tileType ?? 'link',
      embedPlaceId: (tile?.embedData as Record<string, unknown>)?.placeId as string ?? '',
      embedQuery: (tile?.embedData as Record<string, unknown>)?.query as string ?? '',
      embedPdfUrl: (tile?.embedData as Record<string, unknown>)?.pdfUrl as string ?? '',
      embedPdfTitle: (tile?.embedData as Record<string, unknown>)?.title as string ?? '',
      embedPlatform: ((tile?.embedData as Record<string, unknown>)?.platform as 'instagram' | 'facebook') ?? 'instagram',
      embedPostUrl: (tile?.embedData as Record<string, unknown>)?.postUrl as string ?? '',
      embedMaxItems: ((tile?.embedData as Record<string, unknown>)?.maxItems as number) ?? 5,
    },
  });

  const tileType = watch('tileType');

  const onSubmit = useCallback((values: TileFormValues) => {
    setValidationError(null);

    let embedData: Record<string, unknown> | null = null;
    if (values.tileType === 'embed_map') {
      embedData = { placeId: values.embedPlaceId, query: values.embedQuery };
    } else if (values.tileType === 'embed_menu') {
      embedData = { pdfUrl: values.embedPdfUrl, title: values.embedPdfTitle };
    } else if (values.tileType === 'embed_social') {
      embedData = { platform: values.embedPlatform, postUrl: values.embedPostUrl };
    } else if (values.tileType === 'embed_events') {
      embedData = { maxItems: values.embedMaxItems };
    }

    const input: UpsertLinkInBioTileInput = {
      id: tile?.id,
      title: values.title,
      subtitle: values.subtitle || null,
      ctaLabel: values.ctaLabel || 'Visit',
      ctaUrl: values.ctaUrl || '',
      tileType: values.tileType,
      embedData,
    };

    const result = tileSchema.safeParse(input);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      setValidationError(firstIssue?.message ?? 'Validation failed');
      return;
    }

    onSave(input);
  }, [tile?.id, onSave]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-4 text-lg font-semibold">
        {tile ? 'Edit Tile' : 'New Tile'}
      </h3>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Tile type selector */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Tile Type</label>
          <select
            {...register('tileType')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {TILE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label} - {type.description}
              </option>
            ))}
          </select>
        </div>

        {/* Common fields */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Title</label>
          <input
            {...register('title', { required: 'Title is required' })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Tile title"
          />
          {errors.title ? (
            <p className="mt-1 text-xs text-destructive">{errors.title.message}</p>
          ) : null}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Subtitle</label>
          <input
            {...register('subtitle')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Optional subtitle"
          />
        </div>

        {/* Link-specific fields */}
        {(tileType === 'link' || tileType === 'media') ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium">CTA Label</label>
              <input
                {...register('ctaLabel')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Visit"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">URL</label>
              <input
                {...register('ctaUrl')}
                type="url"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="https://..."
              />
            </div>
          </>
        ) : null}

        {/* Embed-specific fields */}
        {tileType === 'embed_map' ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Google Maps Place ID</label>
              <input
                {...register('embedPlaceId')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="ChIJ..."
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Search Query</label>
              <input
                {...register('embedQuery')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="The Anchor, Leatherhead"
              />
            </div>
          </>
        ) : null}

        {tileType === 'embed_menu' ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Menu PDF URL</label>
              <input
                {...register('embedPdfUrl')}
                type="url"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="https://example.com/menu.pdf"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Menu Title</label>
              <input
                {...register('embedPdfTitle')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Our Menu"
              />
            </div>
          </>
        ) : null}

        {tileType === 'embed_social' ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Platform</label>
              <select
                {...register('embedPlatform')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Post URL</label>
              <input
                {...register('embedPostUrl')}
                type="url"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="https://instagram.com/p/..."
              />
            </div>
          </>
        ) : null}

        {tileType === 'embed_events' ? (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Max Events to Show</label>
            <input
              {...register('embedMaxItems', { valueAsNumber: true })}
              type="number"
              min={1}
              max={10}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        ) : null}

        {validationError ? (
          <p className="text-sm text-destructive">{validationError}</p>
        ) : null}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className={cn(
              'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
            )}
          >
            {tile ? 'Update Tile' : 'Add Tile'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
