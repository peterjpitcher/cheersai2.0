'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTournamentBaseImageUploads } from '@/app/actions/tournament-images';

type Aspect = 'square' | 'story';
type UploadedImage = Awaited<ReturnType<typeof getTournamentBaseImageUploads>>[number];

interface TournamentImageUploadsProps {
  tournamentId: string;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const SLOTS = [
  { aspect: 'square', label: 'Square (1:1)' },
  { aspect: 'story', label: 'Story (9:16)' },
] as const;

export function TournamentImageUploads({ tournamentId, disabled = false, onUploadingChange }: TournamentImageUploadsProps) {
  const router = useRouter();
  const inputId = useId();
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<Aspect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTournamentBaseImageUploads(tournamentId)
      .then((result) => { if (!cancelled) setImages(result); })
      .catch(() => { if (!cancelled) setError('Could not load tournament images. Please retry.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tournamentId, reload]);

  async function upload(file: File, aspect: Aspect): Promise<void> {
    setError(null);
    setNotice(null);
    if (!IMAGE_TYPES.includes(file.type)) {
      setError('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      setError('Choose an image smaller than or equal to 4 MB. Empty files cannot be uploaded.');
      return;
    }
    setUploading(aspect);
    onUploadingChange?.(true);
    try {
      const data = new FormData();
      data.set('tournamentId', tournamentId);
      data.set('aspect', aspect);
      data.set('file', file);
      const response = await fetch('/api/tournaments/base-image', { method: 'POST', body: data });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) {
        setError(result.error || 'The image could not be uploaded. Please try again.');
        return;
      }
      setNotice(`${aspect === 'square' ? 'Square' : 'Story'} image saved for this tournament.`);
      router.refresh();
      setReload((value) => value + 1);
    } catch {
      setError('The upload could not be confirmed. Please retry loading the images before uploading again.');
    } finally {
      setUploading(null);
      onUploadingChange?.(false);
    }
  }

  return (
    <section aria-label="Tournament base images" className="space-y-3">
      <h3 className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>Base Images</h3>
      <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
        Upload backgrounds for this tournament&apos;s fixture posts. Images are saved immediately for this tournament only and are not added to the Library. Cancelling settings will not undo an upload.
      </p>
      <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>PNG, JPEG or WebP, up to 4 MB each. Use a square (1:1) image and a story (9:16) image.</p>
      {loading && <p role="status" className="text-sm">Loading tournament images...</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SLOTS.map(({ aspect, label }) => {
          const current = images.find((image) => image.aspectClass === aspect);
          return (
            <div key={aspect} className="min-w-0 space-y-2 rounded-md border p-3" style={{ borderColor: 'var(--c-line)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>{label}</p>
              {current ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={current.previewUrl} alt={`Current ${aspect} tournament background`} className="h-28 w-full object-contain" />
                  <p className="break-words text-xs" style={{ color: 'var(--c-ink-3)' }}>{current.fileName}</p>
                </>
              ) : !loading && <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>No image uploaded.</p>}
              <label htmlFor={`${inputId}-${aspect}`} className="block text-xs font-medium" style={{ color: 'var(--c-ink)' }}>
                {current ? 'Replace' : 'Upload'} {aspect} image
              </label>
              <input
                id={`${inputId}-${aspect}`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={disabled || loading || uploading !== null}
                className="w-full min-w-0 text-xs disabled:opacity-50"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void upload(file, aspect);
                }}
              />
            </div>
          );
        })}
      </div>
      {uploading && <p role="status" className="text-sm">Uploading {uploading} image...</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {error && (
        <div role="alert" className="space-y-1 text-sm" style={{ color: 'var(--c-claret)' }}>
          <p>{error}</p>
          <button type="button" disabled={loading || uploading !== null} className="underline disabled:opacity-50" onClick={() => { setError(null); setReload((value) => value + 1); }}>Retry loading images</button>
        </div>
      )}
    </section>
  );
}
