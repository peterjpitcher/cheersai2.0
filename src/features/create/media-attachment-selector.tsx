"use client";

import clsx from "clsx";
import { Check, ChevronDown, Image as ImageIcon, Plus, Upload, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { MediaAssetInput } from "@/lib/create/schema";
import { finaliseMediaUpload, requestMediaUpload, fetchMediaAssetPreviewUrl } from "@/app/(app)/library/actions";
import { generateImageDerivatives } from "@/lib/library/client-derivatives";
import { MediaAssetEditor } from "@/features/library/media-asset-editor";

const STATUS_LABEL: Record<MediaAssetSummary["processedStatus"], string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_DOT_CLASS: Record<MediaAssetSummary["processedStatus"], string> = {
  pending: "bg-slate-300",
  processing: "bg-blue-400",
  ready: "bg-emerald-500",
  failed: "bg-rose-500",
  skipped: "bg-amber-500",
};

const UNTITLED_TAG = "Untagged";

interface MediaAttachmentSelectorProps {
  assets: MediaAssetSummary[];
  selected: MediaAssetInput[];
  onChange: (next: MediaAssetInput[]) => void;
  label: string;
  description?: string;
  emptyHint?: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(() => new Map());
  const previewUrlsRef = useRef(previewUrls);

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => {
    let cancelled = false;

    const ensurePreviews = async () => {
      for (const asset of assets) {
        if (previewUrlsRef.current.has(asset.id)) continue;
        try {
          const url = await fetchMediaAssetPreviewUrl(asset.id);
          if (cancelled) return;

          if (url) {
            setPreviewUrls((prev) => {
              if (prev.has(asset.id)) return prev;
              const next = new Map(prev);
              next.set(asset.id, url);
              return next;
            });
          }
        } catch (error) {
          if (!cancelled) {
            console.warn("[media-selector] failed to refresh preview", { assetId: asset.id, error });
          }
        }
      }
    };

    void ensurePreviews();

    return () => {
      cancelled = true;
    };
  }, [assets]);

  const handleAssetUpdated = (updated: MediaAssetSummary) => {
    onLibraryUpdate?.((prev) => {
      const existing = prev.find((asset) => asset.id === updated.id);
      if (!existing) {
        return [updated, ...prev];
      }
      return prev.map((asset) => (asset.id === updated.id ? updated : asset));
    });

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

  const handleAssetDeleted = (assetId: string) => {
    onLibraryUpdate?.((prev) => prev.filter((asset) => asset.id !== assetId));
    if (selectedIds.has(assetId)) {
      onChange(selected.filter((item) => item.assetId !== assetId));
    }
    setUploadMessage("Media deleted.");
  };

  const toggleAsset = (asset: MediaAssetSummary) => {
    if (selectedIds.has(asset.id)) {
      onChange(selected.filter((item) => item.assetId !== asset.id));
      return;
    }

    onChange([
      ...selected,
      {
        assetId: asset.id,
        mediaType: asset.mediaType,
        fileName: asset.fileName,
      },
    ]);
  };

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

        if (mediaType === "image" && derivativeUploadUrls) {
          try {
            const derivatives = await generateImageDerivatives(file);
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
        });

        if (summary) {
          uploadedSummaries.push(summary);
          onLibraryUpdate?.((prev) => [summary, ...prev.filter((asset) => asset.id !== summary.id)]);
          if (!selectedIds.has(summary.id)) {
            onChange([
              ...selected,
              {
                assetId: summary.id,
                mediaType: summary.mediaType,
                fileName: summary.fileName,
              },
            ]);
          }
        }
      } catch (error) {
        console.error("[create] media upload failed", error);
        errorMessage = error instanceof Error ? error.message : "Upload failed";
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

  const groupedAssets = useMemo(() => {
    if (!assets.length) {
      return [] as Array<{ tag: string; items: MediaAssetSummary[] }>;
    }

    const groups = new Map<string, MediaAssetSummary[]>();
    for (const asset of assets) {
      const tags = asset.tags.length ? asset.tags : [UNTITLED_TAG];
      for (const rawTag of tags) {
        const key = rawTag.trim().length ? rawTag.trim() : UNTITLED_TAG;
        const bucket = groups.get(key) ?? [];
        bucket.push(asset);
        groups.set(key, bucket);
      }
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === UNTITLED_TAG) return 1;
        if (b === UNTITLED_TAG) return -1;
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      })
      .map(([tag, items]) => ({ tag, items }));
  }, [assets]);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedGroups((previous) => {
      const next = { ...previous };
      let changed = false;
      const presentTags = new Set<string>();

      groupedAssets.forEach((group, index) => {
        presentTags.add(group.tag);
        const hasSelected = group.items.some((item) => selectedIds.has(item.id));
        if (!(group.tag in next)) {
          next[group.tag] = hasSelected || index === 0;
          changed = true;
        } else if (hasSelected && !next[group.tag]) {
          next[group.tag] = true;
          changed = true;
        }
      });

      for (const key of Object.keys(next)) {
        if (!presentTags.has(key)) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [groupedAssets, selectedIds]);

  const toggleGroup = (tag: string) => {
    setExpandedGroups((prev) => ({ ...prev, [tag]: !prev[tag] }));
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
            const asset = assets.find((entry) => entry.id === item.assetId);
            const previewSrc = asset ? previewUrls.get(asset.id) ?? asset.previewUrl : undefined;

            return (
              <div
                key={item.assetId}
                className="flex min-w-[140px] flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm"
              >
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                  {previewSrc ? (
                    asset?.mediaType === "video" ? (
                      <video src={previewSrc} className="max-h-full max-w-full object-contain" preload="metadata" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewSrc} alt={asset?.fileName ?? item.assetId} className="max-h-full max-w-full object-contain" loading="lazy" />
                    )
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-500">
                      {asset?.mediaType === "video" ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">{asset?.fileName ?? item.fileName ?? item.assetId}</p>
                  <p className="text-[11px] text-slate-500">{asset ? STATUS_LABEL[asset.processedStatus] : "Attached"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAsset(item.assetId)}
                  className="rounded-full bg-white/80 p-1 text-slate-500 transition hover:text-slate-900"
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

      {groupedAssets.length ? (
        <div className="space-y-4">
          {groupedAssets.map(({ tag, items }) => {
            const isExpanded = expandedGroups[tag] ?? false;
            return (
              <section key={tag} className="space-y-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(tag)}
                  aria-expanded={isExpanded}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-xl border border-brand-ambergold bg-brand-ambergold px-3 py-2 text-left text-sm font-semibold text-white transition",
                    isExpanded ? "shadow-md ring-1 ring-brand-ambergold/30" : "opacity-85 hover:opacity-100",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <ChevronDown className={clsx("h-4 w-4 transition", isExpanded ? "rotate-0" : "-rotate-90")} />
                    <span>{tag === UNTITLED_TAG ? UNTITLED_TAG : `#${tag}`}</span>
                  </span>
                  <span className="text-xs font-normal text-white/80">{items.length}</span>
                </button>
                {isExpanded ? (
                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {items.map((asset) => {
                      const isSelected = selectedIds.has(asset.id);
                      const isReady = asset.processedStatus === "ready";
                      const isSkipped = asset.processedStatus === "skipped";

                      return (
                        <article
                          key={`${tag}-${asset.id}`}
                          className={clsx(
                            "space-y-3 rounded-2xl border p-3 text-left transition",
                            isSelected ? "border-brand-teal bg-brand-teal/5" : "border-slate-200 bg-white hover:border-slate-300",
                          )}
                        >
                          <div className="flex h-36 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white">
                            {(() => {
                              const previewSrc = previewUrls.get(asset.id) ?? asset.previewUrl;
                              if (!previewSrc) {
                                return (
                                  <div className="flex h-full w-full items-center justify-center text-slate-500">
                                    {asset.mediaType === "video" ? <Video className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                                  </div>
                                );
                              }
                              return asset.mediaType === "video" ? (
                                <video src={previewSrc} className="max-h-full max-w-full object-contain" preload="metadata" muted />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={previewSrc} alt={asset.fileName} className="max-h-full max-w-full object-contain" loading="lazy" />
                              );
                            })()}
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-500">
                            <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white/70 p-1.5 text-slate-600" title={asset.mediaType === "video" ? "Video" : "Image"}>
                              {asset.mediaType === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                              <span className="sr-only">{asset.mediaType === "video" ? "Video" : "Image"}</span>
                            </span>
                            <span className="flex items-center gap-1" title={STATUS_LABEL[asset.processedStatus]}>
                              <span className={clsx("h-2.5 w-2.5 rounded-full", STATUS_DOT_CLASS[asset.processedStatus])} />
                              <span className="sr-only">{STATUS_LABEL[asset.processedStatus]}</span>
                            </span>
                          </div>
                          <MediaAssetEditor
                            asset={asset}
                            variant="compact"
                            suppressRefresh
                            onAssetUpdated={handleAssetUpdated}
                            onAssetDeleted={handleAssetDeleted}
                            footerSlot={
                              <button
                                type="button"
                                onClick={() => toggleAsset(asset)}
                                disabled={(!isReady && !isSelected) || isSkipped}
                                className="rounded-full border border-brand-ambergold bg-brand-ambergold p-1.5 text-white transition hover:bg-brand-ambergold/90 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label={isSelected ? "Detach from selection" : "Attach to selection"}
                                title={isSelected ? "Detach" : "Attach"}
                              >
                                {isSelected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                              </button>
                            }
                          />
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          {emptyHint}
        </div>
      )}
    </div>
  );
}
