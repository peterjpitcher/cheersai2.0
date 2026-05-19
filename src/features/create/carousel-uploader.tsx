'use client';

/**
 * Carousel multi-image uploader with drag-and-drop reorder (06-05, D-15).
 * Supports 2-10 images for Instagram carousel posts.
 * Uses @dnd-kit/sortable for image reorder.
 */

import { useCallback, useRef, useState } from 'react';
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ImagePlus, Trash2, AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface CarouselImage {
  id: string;
  url: string;
  file?: File;
}

interface CarouselUploaderProps {
  images: CarouselImage[];
  onChange: (images: CarouselImage[]) => void;
  maxImages?: number;
}

const MIN_IMAGES = 2;
const DEFAULT_MAX_IMAGES = 10;
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB per image

// Instagram aspect ratio constraints: between 4:5 (0.8) and 1.91:1 (1.91)
const MIN_ASPECT_RATIO = 0.8;   // 4:5 portrait
const MAX_ASPECT_RATIO = 1.91;  // 1.91:1 landscape

function validateAspectRatio(width: number, height: number): boolean {
  const ratio = width / height;
  return ratio >= MIN_ASPECT_RATIO && ratio <= MAX_ASPECT_RATIO;
}

function generateId(): string {
  return `carousel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Sortable image tile
// ---------------------------------------------------------------------------

interface SortableImageProps {
  image: CarouselImage;
  index: number;
  onRemove: (id: string) => void;
}

function SortableImage({ image, index, onRemove }: SortableImageProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative group rounded-lg border border-border overflow-hidden bg-muted',
        isDragging && 'opacity-50 z-50 shadow-lg',
      )}
    >
      {/* Position badge */}
      <div className="absolute top-2 left-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/80 text-xs font-bold text-background">
        {index + 1}
      </div>

      {/* Drag handle */}
      <button
        type="button"
        className="absolute top-2 right-10 z-10 flex h-6 w-6 items-center justify-center rounded bg-foreground/60 text-background opacity-0 transition-opacity group-hover:opacity-100 cursor-grab active:cursor-grabbing"
        aria-label={`Drag to reorder image ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(image.id)}
        className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Remove image ${index + 1}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* Thumbnail — blob URL from local upload, next/image unsupported */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={`Carousel image ${index + 1}`}
        className="aspect-square w-full object-cover"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CarouselUploader({
  images,
  onChange,
  maxImages = DEFAULT_MAX_IMAGES,
}: CarouselUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const canAddMore = images.length < maxImages;

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = images.findIndex((img) => img.id === active.id);
      const newIndex = images.findIndex((img) => img.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      onChange(arrayMove(images, oldIndex, newIndex));
    },
    [images, onChange],
  );

  const handleRemove = useCallback(
    (id: string) => {
      onChange(images.filter((img) => img.id !== id));
    },
    [images, onChange],
  );

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const remaining = maxImages - images.length;

      if (fileArray.length > remaining) {
        setErrors([`Maximum ${maxImages} images allowed. Only adding first ${remaining}.`]);
      }

      const toProcess = fileArray.slice(0, remaining);
      const newErrors: string[] = [];
      const newImages: CarouselImage[] = [];

      for (const file of toProcess) {
        // Check file type
        if (!file.type.startsWith('image/')) {
          newErrors.push(`${file.name}: not an image file`);
          continue;
        }

        // Check file size (8MB max)
        if (file.size > MAX_FILE_SIZE_BYTES) {
          newErrors.push(`${file.name}: exceeds 8MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
          continue;
        }

        // Check aspect ratio (Instagram: between 4:5 and 1.91:1)
        try {
          const isValid = await checkImageAspectRatio(file);
          if (!isValid) {
            newErrors.push(
              `${file.name}: aspect ratio must be between 4:5 and 1.91:1`,
            );
            continue;
          }
        } catch {
          newErrors.push(`${file.name}: could not read image dimensions`);
          continue;
        }

        const url = URL.createObjectURL(file);
        newImages.push({ id: generateId(), url, file });
      }

      if (newErrors.length > 0) {
        setErrors(newErrors);
      } else {
        setErrors([]);
      }

      if (newImages.length > 0) {
        onChange([...images, ...newImages]);
      }
    },
    [images, maxImages, onChange],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
      }
      // Reset input so same file can be re-selected
      e.target.value = '';
    },
    [processFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  return (
    <div className="space-y-3">
      {/* Upload zone */}
      {canAddMore && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/50 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          aria-label="Upload carousel images"
        >
          <ImagePlus className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop images here or click to browse
          </p>
          <p className="text-xs text-muted-foreground/70">
            {images.length}/{maxImages} images ({MIN_IMAGES} min) | Max 8MB | Aspect ratio 4:5 to 1.91:1
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* Error messages */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          {errors.map((err, i) => (
            <p key={i} className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {err}
            </p>
          ))}
        </div>
      )}

      {/* Preview grid with DnD reorder */}
      {images.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={images.map((img) => img.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.map((image, index) => (
                <SortableImage
                  key={image.id}
                  image={image}
                  index={index}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Min images warning */}
      {images.length > 0 && images.length < MIN_IMAGES && (
        <p className="text-sm text-amber-600">
          Instagram carousels require at least {MIN_IMAGES} images.
          Add {MIN_IMAGES - images.length} more.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkImageAspectRatio(file: File): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(validateAspectRatio(img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(file);
  });
}
