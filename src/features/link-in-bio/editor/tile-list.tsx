'use client';

/**
 * Sortable tile list for link-in-bio editor (D-04).
 * Uses @dnd-kit/sortable for drag-and-drop reordering.
 * Maximum 12 tiles per LIB-03.
 */

import { useCallback, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/lib/utils';
import type { LinkInBioTile, UpsertLinkInBioTileInput } from '@/lib/link-in-bio/types';
import { TileEditor } from './tile-editor';

interface TileListProps {
  tiles: LinkInBioTile[];
  onReorder: (tileIdsInOrder: string[]) => Promise<void>;
  onSaveTile: (input: UpsertLinkInBioTileInput) => Promise<void>;
  onDeleteTile: (tileId: string) => Promise<void>;
}

const TILE_TYPE_LABELS: Record<string, string> = {
  link: 'Link',
  media: 'Media',
  embed_map: 'Map',
  embed_menu: 'Menu',
  embed_social: 'Social',
  embed_events: 'Events',
};

const MAX_TILES = 12;

function SortableItem({
  tile,
  onEdit,
  onDelete,
}: {
  tile: LinkInBioTile;
  onEdit: (tile: LinkInBioTile) => void;
  onDelete: (tileId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tile.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-shadow',
        isDragging && 'shadow-lg opacity-90 z-10',
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11" cy="13" r="1.5" />
        </svg>
      </button>

      {/* Tile info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{tile.title}</p>
        <p className="text-xs text-muted-foreground">
          {TILE_TYPE_LABELS[tile.tileType] ?? tile.tileType}
          {!tile.enabled ? ' (disabled)' : ''}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(tile)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label={`Edit ${tile.title}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onDelete(tile.id)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          aria-label={`Delete ${tile.title}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function TileList({ tiles, onReorder, onSaveTile, onDeleteTile }: TileListProps) {
  const [editingTile, setEditingTile] = useState<LinkInBioTile | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = tiles.findIndex((t) => t.id === active.id);
      const newIndex = tiles.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(tiles, oldIndex, newIndex);
      void onReorder(reordered.map((t) => t.id));
    },
    [tiles, onReorder],
  );

  const handleEdit = useCallback((tile: LinkInBioTile) => {
    setEditingTile(tile);
    setIsAdding(false);
  }, []);

  const handleDelete = useCallback(
    (tileId: string) => {
      void onDeleteTile(tileId);
    },
    [onDeleteTile],
  );

  const handleSave = useCallback(
    (input: UpsertLinkInBioTileInput) => {
      void onSaveTile(input);
      setEditingTile(null);
      setIsAdding(false);
    },
    [onSaveTile],
  );

  const handleCancel = useCallback(() => {
    setEditingTile(null);
    setIsAdding(false);
  }, []);

  const handleAddNew = useCallback(() => {
    setEditingTile(null);
    setIsAdding(true);
  }, []);

  const canAddMore = tiles.length < MAX_TILES;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {tiles.length}/{MAX_TILES} tiles
        </p>
        <button
          type="button"
          onClick={handleAddNew}
          disabled={!canAddMore}
          className={cn(
            'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
            canAddMore ? 'hover:bg-primary/90' : 'opacity-50 cursor-not-allowed',
          )}
        >
          Add Tile
        </button>
      </div>

      {/* Editing / adding tile form */}
      {(editingTile || isAdding) ? (
        <TileEditor
          tile={editingTile}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : null}

      {/* Sortable tile list */}
      {tiles.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tiles.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {tiles.map((tile) => (
                <SortableItem
                  key={tile.id}
                  tile={tile}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No tiles yet. Add your first tile to get started.
          </p>
        </div>
      )}
    </div>
  );
}
