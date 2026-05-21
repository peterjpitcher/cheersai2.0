'use client';

import { CloudUpload, Loader2 } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MediaGrid } from '@/features/library/media-grid';
import { validateMediaFile } from '@/lib/media/upload';
import type { MediaAssetSummary } from '@/lib/library/data';
import { finaliseMediaUpload, requestMediaUpload } from '@/app/(app)/library/actions';
import { generateImageDerivatives } from '@/lib/library/client-derivatives';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MediaUploadPanelProps {
  accountId: string;
  onUploadComplete: (item: MediaAssetSummary) => void;
  /** Existing library items for the "Library" tab picker */
  libraryItems?: MediaAssetSummary[];
  /** Callback when selecting from existing library */
  onLibrarySelect?: (id: string) => void;
  /** Currently selected IDs (for library tab) */
  selectedIds?: string[];
  /** Hide the placeholder URL import tab in contexts where only upload/library are useful. */
  showUrlTab?: boolean;
}

// ---------------------------------------------------------------------------
// MediaUploadPanel
// ---------------------------------------------------------------------------

/**
 * Media upload panel (D-12):
 * - Drop Zone (drag-drop + browse) with upload progress
 * - Library (pick from existing media in selectable mode)
 * - URL (paste an image URL - stretch goal)
 *
 * Validates file type and size (10MB max) before upload.
 */
export function MediaUploadPanel({
  accountId,
  onUploadComplete,
  libraryItems = [],
  onLibrarySelect,
  selectedIds = [],
  showUrlTab = true,
}: MediaUploadPanelProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState('dropzone');
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const files = e.dataTransfer?.files;
      if (files?.length) {
        void processFiles(Array.from(files));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files?.length) {
        void processFiles(Array.from(files));
      }
      // Reset input so re-selecting the same file triggers onChange
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId],
  );

  // Process uploaded files using the signed-URL upload pattern
  const processFiles = async (files: File[]): Promise<void> => {
    setError(null);

    for (const file of files) {
      // Client-side validation
      const validationError = validateMediaFile(file);
      if (validationError) {
        setError(validationError.message);
        continue;
      }

      const tempId = `${file.name}-${Date.now()}`;
      setUploading((prev) => [...prev, { id: tempId, name: file.name, progress: 'uploading' }]);

      try {
        // Request signed upload URL
        const { assetId, uploadUrl, storagePath, derivativeUploadUrls, mediaType } =
          await requestMediaUpload({
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
          });

        updateProgress(tempId, 'processing');

        // Upload file to signed URL
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        // Generate derivatives for images
        let derivedVariants: Record<string, string> | undefined;
        let aspectClass: 'square' | 'story' | 'landscape' | undefined;

        if (mediaType === 'image' && derivativeUploadUrls) {
          try {
            const { blobs: derivatives, aspectClass: detectedClass } =
              await generateImageDerivatives(file);
            aspectClass = detectedClass;
            const uploadedVariants: Record<string, string> = {};

            for (const [variant, info] of Object.entries(derivativeUploadUrls) as Array<
              [string, { uploadUrl: string; storagePath: string; contentType: string }]
            >) {
              if (!info) continue;
              const blob = derivatives[variant as keyof typeof derivatives];
              if (!blob) continue;

              const derivativeResponse = await fetch(info.uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': info.contentType },
                body: blob,
              });

              if (!derivativeResponse.ok) {
                throw new Error(`Derivative upload failed (${variant})`);
              }

              uploadedVariants[variant] = info.storagePath;
            }

            if (Object.keys(uploadedVariants).length) {
              derivedVariants = uploadedVariants;
            }
          } catch (derivativeError) {
            console.error('[media-upload] derivative generation failed', derivativeError);
          }
        }

        // Finalise: insert DB record, get summary with preview URL
        const summary = await finaliseMediaUpload({
          assetId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          storagePath,
          derivedVariants,
          aspectClass,
        });

        updateProgress(tempId, 'complete');

        if (summary) {
          onUploadComplete(summary);
        }
      } catch (err) {
        console.error('[media-upload] upload failed', err);
        updateProgress(tempId, 'error');
        setError(err instanceof Error ? err.message : 'Upload failed');
      }
    }
  };

  const updateProgress = (id: string, progress: UploadingFile['progress']): void => {
    setUploading((prev) =>
      prev.map((item) => (item.id === id ? { ...item, progress } : item)),
    );
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full justify-start">
        <TabsTrigger value="dropzone">Upload</TabsTrigger>
        <TabsTrigger value="library">Library</TabsTrigger>
        {showUrlTab ? <TabsTrigger value="url">URL</TabsTrigger> : null}
      </TabsList>

      {/* Drop Zone Tab */}
      <TabsContent value="dropzone">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={clsx(
            'rounded-[var(--r-lg)] border-[1.5px] border-dashed p-8 text-center transition-colors',
            isDragging
              ? 'border-[var(--c-orange)] bg-[var(--c-orange-soft)]'
              : 'border-[var(--c-line-2)] bg-transparent hover:border-[var(--c-orange)]/40',
          )}
        >
          <CloudUpload className="mx-auto h-8 w-8 text-[var(--c-ink-3)]" />
          <p className="mt-3 text-[13px] text-[var(--c-ink-3)]">
            Drag and drop images here, or{' '}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="font-semibold text-[var(--c-orange)] underline-offset-2 hover:underline"
            >
              browse files
            </button>
          </p>
          <p className="mt-1 text-[11px] text-[var(--c-ink-4)]">
            JPEG, PNG, WebP, GIF -- max 10 MB per file
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Upload progress */}
        {uploading.length > 0 && (
          <div className="mt-3 space-y-2">
            {uploading.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-3 py-2 text-[13px]"
              >
                <span className="truncate text-[var(--c-ink)]">{item.name}</span>
                <span className="ml-2 shrink-0 text-[11px] text-[var(--c-ink-3)]">
                  {item.progress === 'uploading' && (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Uploading
                    </span>
                  )}
                  {item.progress === 'processing' && (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Processing
                    </span>
                  )}
                  {item.progress === 'complete' && 'Ready'}
                  {item.progress === 'error' && (
                    <span className="text-rose-500">Failed</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="mt-2 text-[11px] text-rose-500">{error}</p>
        )}
      </TabsContent>

      {/* Library Tab */}
      <TabsContent value="library">
        <MediaGrid
          items={libraryItems}
          selectable
          selectedIds={selectedIds}
          onSelect={onLibrarySelect}
        />
      </TabsContent>

      {showUrlTab ? (
        <TabsContent value="url">
          <div className="rounded-[var(--r-lg)] border-[1.5px] border-dashed border-[var(--c-line-2)] p-6 text-center">
            <p className="text-[13px] text-[var(--c-ink-3)]">
              Paste an image URL to import. Coming soon.
            </p>
          </div>
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UploadingFile {
  id: string;
  name: string;
  progress: 'uploading' | 'processing' | 'complete' | 'error';
}
