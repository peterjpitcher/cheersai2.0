"use client";

import { Image as ImageIcon, Upload, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { MediaAssetInput } from "@/lib/create/schema";
import { finaliseMediaUpload, requestMediaUpload, fetchMediaAssetPreviewUrl } from "@/app/(app)/library/actions";
import { generateImageDerivatives } from "@/lib/library/client-derivatives";
import { MediaLibraryPickerGrid } from "@/features/library/media-library-picker-grid";

const STATUS_LABEL: Record<MediaAssetSummary["processedStatus"], string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  skipped: "Skipped",
};

interface MediaAttachmentSelectorProps {
  assets: MediaAssetSummary[];
  selected: MediaAssetInput[];
  onChange: (next: MediaAssetInput[]) => void;
  label: string;
  description?: string;
  emptyHint?: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
}

function mergeSelections(existing: MediaAssetInput[], additions: MediaAssetInput[]) {
  if (!additions.length) {
    return existing;
  }

  const next = [...existing];
  const seen = new Set(existing.map((item) => item.assetId));
  let changed = false;
  for (const addition of additions) {
    if (seen.has(addition.assetId)) continue;
    seen.add(addition.assetId);
    next.push(addition);
    changed = true;
  }
  return changed ? next : existing;
}

export function MediaAttachmentSelector({
  assets,
  selected,
  onChange,
  label,
  description,
  emptyHint = "Upload media in the Library to attach it here.",
  onLibraryUpdate,
}: MediaAttachmentSelectorProps) {
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.assetId)), [selected]);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(() => new Map());
  const previewUrlsRef = useRef(previewUrls);
  const attemptedPreviewAssetIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => {
    let cancelled = false;

    const ensurePreviews = async () => {
      // Candidate ids that need a fetched preview: library assets without an
      // inline preview, plus any currently-selected asset that is NOT in the
      // (hidden-filtered) library — those are attached-but-hidden and must still
      // render their thumbnail so the owner can see what is on the post.
      const candidateIds = new Set<string>();
      for (const asset of assets) {
        if (!asset.previewUrl) candidateIds.add(asset.id);
      }
      for (const item of selected) {
        if (!assetById.has(item.assetId)) candidateIds.add(item.assetId);
      }

      attemptedPreviewAssetIdsRef.current.forEach((assetId) => {
        if (!candidateIds.has(assetId)) {
          attemptedPreviewAssetIdsRef.current.delete(assetId);
        }
      });

      const idsToFetch = [...candidateIds].filter((assetId) => {
        if (previewUrlsRef.current.has(assetId)) return false;
        if (attemptedPreviewAssetIdsRef.current.has(assetId)) return false;
        return true;
      });

      if (!idsToFetch.length) return;

      idsToFetch.forEach((assetId) => {
        attemptedPreviewAssetIdsRef.current.add(assetId);
      });

      const resolved = await Promise.all(
        idsToFetch.map(async (assetId) => {
          try {
            const url = await fetchMediaAssetPreviewUrl(assetId);
            return url ? ([assetId, url] as const) : null;
          } catch (error) {
            console.warn("[media-selector] failed to refresh preview", { assetId, error });
            return null;
          }
        }),
      );

      if (cancelled) return;

      setPreviewUrls((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const entry of resolved) {
          if (!entry) continue;
          const [assetId, url] = entry;
          if (next.has(assetId)) continue;
          next.set(assetId, url);
          changed = true;
        }
        return changed ? next : prev;
      });
    };

    void ensurePreviews();

    return () => {
      cancelled = true;
    };
  }, [assets, selected, assetById]);

  const handleAssetUpdated = (updated: MediaAssetSummary) => {
    if (selectedIds.has(updated.id)) {
      onChange(
        selected.map((item) =>
          item.assetId === updated.id
            ? {
                ...item,
                fileName: updated.fileName,
                mediaType: updated.mediaType,
              }
            : item,
        ),
      );
    }
  };

  const handleSelectionChange = useCallback(
    (nextIds: string[]) => {
      const existingById = new Map(selected.map((item) => [item.assetId, item]));
      const next = nextIds.flatMap((assetId) => {
        const asset = assetById.get(assetId);
        const existing = existingById.get(assetId);
        if (!asset) {
          return existing ? [existing] : [];
        }
        return [
          {
            assetId: asset.id,
            mediaType: asset.mediaType,
            fileName: asset.fileName,
          } satisfies MediaAssetInput,
        ];
      });
      onChange(next);
    },
    [assetById, onChange, selected],
  );

  const removeAsset = (assetId: string) => {
    onChange(selected.filter((item) => item.assetId !== assetId));
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadMessage(null);
    setIsUploading(true);

    const uploadedSummaries: MediaAssetSummary[] = [];
    const selectionAdditions: MediaAssetInput[] = [];
    let errorMessage: string | null = null;

    for (const file of Array.from(files)) {
      try {
        const { assetId, uploadUrl, storagePath, derivativeUploadUrls, mediaType } = await requestMediaUpload({
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        });

        const response = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
          },
          body: file,
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        let derivedVariants: Record<string, string> | undefined;
        let aspectClass: "square" | "story" | "landscape" | undefined;

        if (mediaType === "image" && derivativeUploadUrls) {
          try {
            const { blobs: derivatives, aspectClass: detectedClass } = await generateImageDerivatives(file);
            aspectClass = detectedClass;
            const uploadedVariants: Record<string, string> = {};

            for (const [variant, info] of Object.entries(derivativeUploadUrls) as Array<
              [keyof typeof derivativeUploadUrls, { uploadUrl: string; storagePath: string; contentType: string }]
            >) {
              if (!info) continue;
              const blob = derivatives[variant];
              if (!blob) continue;

              const derivativeResponse = await fetch(info.uploadUrl, {
                method: "PUT",
                headers: {
                  "Content-Type": info.contentType,
                },
                body: blob,
              });

              if (!derivativeResponse.ok) {
                throw new Error(`Derivative upload failed (${variant}) status ${derivativeResponse.status}`);
              }

              uploadedVariants[variant] = info.storagePath;
            }

            if (Object.keys(uploadedVariants).length) {
              derivedVariants = uploadedVariants;
            }
          } catch (derivativeError) {
            console.error("[create] derivative generation failed", derivativeError);
          }
        }

        const summary = await finaliseMediaUpload({
          assetId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          storagePath,
          derivedVariants,
          aspectClass,
        });

        if (summary) {
          uploadedSummaries.push(summary);
          onLibraryUpdate?.((prev) => [summary, ...prev.filter((asset) => asset.id !== summary.id)]);
          selectionAdditions.push({
            assetId: summary.id,
            mediaType: summary.mediaType,
            fileName: summary.fileName,
          });
        }
      } catch (error) {
        console.error("[create] media upload failed", error);
        errorMessage = error instanceof Error ? error.message : "Upload failed";
      }
    }

    if (selectionAdditions.length) {
      const nextSelection = mergeSelections(selected, selectionAdditions);
      if (nextSelection !== selected) {
        onChange(nextSelection);
      }
    }

    if (errorMessage) {
      setUploadMessage(errorMessage);
    } else if (uploadedSummaries.length) {
      setUploadMessage(`${uploadedSummaries.length} file${uploadedSummaries.length > 1 ? "s" : ""} uploaded.`);
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          {description ? <p className="text-xs text-slate-500">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {isUploading ? <span className="text-slate-600">Uploading…</span> : null}
          <button
            type="button"
            onClick={handleUploadClick}
            className="flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload media
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={(event) => void handleFiles(event.target.files)}
            className="hidden"
          />
        </div>
      </div>

      {uploadMessage ? <p className="text-xs text-slate-500">{uploadMessage}</p> : null}

      {selected.length ? (
        <div className="flex w-full flex-wrap gap-2">
          {selected.map((item) => {
            // Resolve from the library first; for attached-but-hidden media the
            // asset is absent from the library, so fall back to the selection's
            // own metadata and the separately-fetched preview url.
            const asset = assetById.get(item.assetId);
            const mediaType = asset?.mediaType ?? item.mediaType;
            const previewSrc = asset?.previewUrl ?? previewUrls.get(item.assetId);
            const label = asset?.fileName ?? item.fileName ?? item.assetId;

            return (
              <div
                key={item.assetId}
                className="flex min-w-[140px] flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm"
              >
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                  {previewSrc ? (
                    mediaType === "video" ? (
                      <video src={previewSrc} className="max-h-full max-w-full object-contain" preload="metadata" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewSrc} alt={label} className="max-h-full max-w-full object-contain" loading="lazy" />
                    )
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-500">
                      {mediaType === "video" ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">{label}</p>
                  <p className="text-[11px] text-slate-500">{asset ? STATUS_LABEL[asset.processedStatus] : "Attached"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAsset(item.assetId)}
                  className="rounded-full bg-white/80 p-2 text-slate-500 transition hover:text-slate-900"
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No media attached yet.</p>
      )}

      <MediaLibraryPickerGrid
        items={assets}
        selectedIds={selected.map((item) => item.assetId)}
        onSelectionChange={handleSelectionChange}
        onItemsChange={onLibraryUpdate}
        onAssetUpdated={handleAssetUpdated}
        emptyHint={emptyHint}
        selectLabel="Attach"
        selectedLabel="Selected"
        getPreviewUrl={(asset) => asset.previewUrl ?? previewUrls.get(asset.id)}
        isAssetSelectable={(asset) => asset.processedStatus === "ready"}
        getUnavailableLabel={(asset) => {
          if (asset.processedStatus === "skipped") return "Unsupported";
          if (asset.processedStatus !== "ready") return "Processing";
          return null;
        }}
      />
    </div>
  );
}
