"use client";

import clsx from "clsx";
import { EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useTransition, type DragEvent } from "react";

import {
  bulkDeleteMediaAssets,
  fetchMediaAssetOriginalUrl,
  finaliseMediaUpload,
  hideMediaAssets,
  hideMediaAssetsByTag,
  requestMediaUpload,
  type BulkDeleteMediaAssetsResult,
  type HideByTagResult,
  type HideMediaAssetsResult,
} from "@/app/(app)/library/actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { LazyImageRow } from "@/features/library/lazy-image-row";
import { MediaAssetEditor } from "@/features/library/media-asset-editor";
import { generateImageDerivatives } from "@/lib/library/client-derivatives";
import type { MediaAssetSummary } from "@/lib/library/data";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MEDIA_TYPE_LABEL = {
  image: "Image",
  video: "Video",
} as const;

const STATUS_LABEL = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  skipped: "Skipped",
} as const;

const UNTITLED_TAG = "Untagged";

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
];

type MediaTypeFilter = "all" | "image" | "video";
type BannerState = { tone: "success" | "error" | "info"; message: string };

type AssetGroup = {
  tag: string;
  items: MediaAssetSummary[];
  isUntagged: boolean;
};

type BulkContext = {
  tag?: string;
  matchedCount?: number;
  label?: string;
};

interface UploadingAsset {
  id: string;
  name: string;
  status: "uploading" | "processing" | "complete" | "error";
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function groupAssetsByTag(assets: MediaAssetSummary[]): AssetGroup[] {
  const tagGroups = new Map<string, AssetGroup>();

  for (const asset of assets) {
    const tags = asset.tags.length ? asset.tags : [UNTITLED_TAG];
    for (const rawTag of tags) {
      const tag = rawTag.trim().length ? rawTag.trim() : UNTITLED_TAG;
      const existing = tagGroups.get(tag);
      if (existing) {
        existing.items.push(asset);
      } else {
        tagGroups.set(tag, { tag, items: [asset], isUntagged: tag === UNTITLED_TAG });
      }
    }
  }

  return Array.from(tagGroups.values()).sort((a, b) => {
    if (a.isUntagged) return 1;
    if (b.isUntagged) return -1;
    return a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" });
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface MediaAssetGridClientProps {
  assets: MediaAssetSummary[];
  availableTags: string[];
}

export function MediaAssetGridClient({
  assets,
  availableTags,
}: MediaAssetGridClientProps) {
  /* --- state --- */
  const [library, setLibrary] = useState<MediaAssetSummary[]>(assets);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "selected" | "hide-selected" | "hide-tag" | "hide-group" | null
  >(null);
  const [pendingTag, setPendingTag] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [previewAsset, setPreviewAsset] = useState<MediaAssetSummary | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [originalUrls, setOriginalUrls] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Filter state
  const [typeFilter, setTypeFilter] = useState<MediaTypeFilter>("all");
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingAsset[]>([]);

  /* --- derived --- */
  const filteredLibrary = useMemo(() => {
    let result = library;
    if (typeFilter !== "all") {
      result = result.filter((a) => a.mediaType === typeFilter);
    }
    if (activeTagFilters.length > 0) {
      result = result.filter((a) =>
        activeTagFilters.some((tag) => a.tags.map((t) => t.trim()).includes(tag)),
      );
    }
    return result;
  }, [library, typeFilter, activeTagFilters]);

  const tagGroups = useMemo(() => groupAssetsByTag(filteredLibrary), [filteredLibrary]);
  const selectedCount = selectedIds.size;
  const displayCount = library.length;

  /* --- tag filter --- */
  const toggleTagFilter = useCallback((tag: string) => {
    setActiveTagFilters((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  /* --- upload handlers --- */
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
        void handleFiles(files);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const tempId = `${file.name}-${Date.now()}`;
      setUploading((prev) => [
        { id: tempId, name: file.name, status: "uploading" },
        ...prev,
      ]);

      try {
        const { assetId, uploadUrl, storagePath, derivativeUploadUrls, mediaType } = await requestMediaUpload({
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        });

        updateUploadStatus(tempId, "processing");

        const response = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
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
            const variantEntries = Object.entries(derivativeUploadUrls) as Array<
              [keyof typeof derivativeUploadUrls, { uploadUrl: string; storagePath: string; contentType: string }]
            >;
            const uploadedVariants: Record<string, string> = {};

            for (const [variantKey, info] of variantEntries) {
              if (!info) continue;
              const blob = derivatives[variantKey];
              if (!blob) continue;

              const uploadResponse = await fetch(info.uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": info.contentType },
                body: blob,
              });

              if (!uploadResponse.ok) {
                throw new Error(`Derivative upload failed (${variantKey}) status ${uploadResponse.status}`);
              }

              uploadedVariants[variantKey] = info.storagePath;
            }

            if (Object.keys(uploadedVariants).length) {
              derivedVariants = uploadedVariants;
            }
          } catch (derivativeError) {
            console.error("[library] derivative generation failed", derivativeError);
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

        updateUploadStatus(tempId, "complete");
        if (summary) {
          setLibrary((prev) => [summary, ...prev]);
        }
      } catch (error) {
        console.error("[library] upload failed", error);
        updateUploadStatus(tempId, "error", error instanceof Error ? error.message : "Upload failed");
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const updateUploadStatus = (tempId: string, status: UploadingAsset["status"], error?: string) => {
    setUploading((prev) =>
      prev.map((item) =>
        item.id === tempId ? { ...item, status, error } : item,
      ),
    );
  };

  /* --- preview handlers --- */
  const handlePreviewOpenChange = (open: boolean) => {
    setPreviewOpen(open);
    if (!open) {
      setPreviewAsset(null);
      setPreviewError(null);
    }
  };

  const openAssetPreview = (asset: MediaAssetSummary) => {
    setPreviewAsset(asset);
    setPreviewError(null);
    setPreviewOpen(true);

    if (originalUrls[asset.id]) {
      return;
    }

    startPreviewTransition(async () => {
      try {
        const url = await fetchMediaAssetOriginalUrl(asset.id);
        if (!url) {
          setPreviewError("Unable to load full-size preview.");
          return;
        }
        setOriginalUrls((prev) => ({ ...prev, [asset.id]: url }));
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to load full-size preview.";
        setPreviewError(description);
      }
    });
  };

  /* --- selection handlers --- */
  const toggleAssetSelection = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  };

  const toggleGroupSelection = (assetIds: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const isFullySelected = assetIds.every((id) => next.has(id));
      for (const id of assetIds) {
        if (isFullySelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleAssetUpdated = (updated: MediaAssetSummary) => {
    setLibrary((prev) => prev.map((asset) => (asset.id === updated.id ? { ...asset, ...updated } : asset)));
  };

  const handleAssetDeleted = (assetId: string) => {
    setLibrary((prev) => prev.filter((asset) => asset.id !== assetId));
    setSelectedIds((prev) => {
      if (!prev.has(assetId)) return prev;
      const next = new Set(prev);
      next.delete(assetId);
      return next;
    });
    setBanner({ tone: "success", message: "Media deleted" });
  };

  /* --- bulk action handlers (preserve existing logic) --- */
  const applyBulkResult = (
    result: BulkDeleteMediaAssetsResult,
    context?: BulkContext,
  ) => {
    const deletedIds = new Set(result.deleted.map((entry) => entry.assetId));
    if (deletedIds.size) {
      setLibrary((prev) => prev.filter((asset) => !deletedIds.has(asset.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of deletedIds) {
          next.delete(id);
        }
        return next;
      });
    }

    if (context?.matchedCount === 0 && context.tag) {
      setBanner({ tone: "info", message: `No assets found for #${context.tag}` });
      return;
    }

    const messageParts: string[] = [];
    if (context?.tag) {
      messageParts.push(`Tag #${context.tag}`);
    } else if (context?.label) {
      messageParts.push(context.label);
    }
    if (result.deleted.length) {
      messageParts.push(`Deleted ${result.deleted.length}`);
    }
    if (result.inUse.length) {
      messageParts.push(`${result.inUse.length} blocked (in use)`);
    }
    if (result.notFound.length) {
      messageParts.push(`${result.notFound.length} missing`);
    }
    if (result.errors.length) {
      messageParts.push(`${result.errors.length} failed`);
    }

    const tone: BannerState["tone"] =
      result.errors.length || result.inUse.length ? "error" : result.deleted.length ? "success" : "info";

    const fallback =
      context?.tag && !result.deleted.length && !result.inUse.length && !result.errors.length && !result.notFound.length
        ? `No deletions for #${context.tag}`
        : "No deletions made";

    const blockedNames = result.inUse
      .map((entry) => entry.fileName || entry.assetId)
      .filter(Boolean)
      .slice(0, 3);
    const blockedNote = result.inUse.length
      ? `Blocked assets are still attached to campaigns or drafted/scheduled posts${
          blockedNames.length ? ` (e.g. ${blockedNames.join(", ")})` : ""
        }. Detach them, then retry.`
      : null;

    const errorDetails =
      result.errors.length && result.errors[0]
        ? `Error: ${result.errors[0].message ?? "Unable to delete some assets."}`
        : null;

    const detailParts = [blockedNote, errorDetails].filter(Boolean);

    setBanner({
      tone,
      message: [messageParts.length ? messageParts.join(" · ") : fallback, ...detailParts].join(" "),
    });
  };

  const applyHideResult = (
    result: HideMediaAssetsResult & Partial<HideByTagResult>,
    context?: BulkContext,
  ) => {
    const hiddenIds = new Set(result.hiddenIds);
    if (hiddenIds.size) {
      setLibrary((prev) => prev.filter((asset) => !hiddenIds.has(asset.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of hiddenIds) {
          next.delete(id);
        }
        return next;
      });
    }

    if (context?.matchedCount === 0 && context.tag) {
      setBanner({ tone: "info", message: `No assets found for #${context.tag}` });
      return;
    }

    const messageParts: string[] = [];
    if (context?.tag) {
      messageParts.push(`Tag #${context.tag}`);
    } else if (context?.label) {
      messageParts.push(context.label);
    }
    if (result.hiddenIds.length) {
      messageParts.push(`Hidden ${result.hiddenIds.length}`);
    }
    if (result.notFound.length) {
      messageParts.push(`${result.notFound.length} missing`);
    }

    const tone: BannerState["tone"] = result.hiddenIds.length ? "success" : "info";
    const fallback = context?.tag ? `No assets hidden for #${context.tag}` : "No assets hidden";

    setBanner({ tone, message: messageParts.length ? messageParts.join(" · ") : fallback });
  };

  const confirmDelete = (message: string) => (typeof window === "undefined" ? true : window.confirm(message));

  const handleDeleteSelected = () => {
    if (!selectedCount) return;

    const confirmation = confirmDelete(
      selectedCount === 1 ? "Delete 1 selected asset from your library?" : `Delete ${selectedCount} selected assets?`,
    );
    if (!confirmation) return;

    setPendingAction("selected");
    setBanner(null);
    const assetIds = Array.from(selectedIds);

    startTransition(async () => {
      try {
        const result = await bulkDeleteMediaAssets({ assetIds });
        applyBulkResult(result, { label: "Selected assets", matchedCount: assetIds.length });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to delete selected assets.";
        setBanner({ tone: "error", message: description });
      } finally {
        setPendingAction(null);
        setPendingTag(null);
      }
    });
  };

  const handleHideSelected = () => {
    if (!selectedCount) return;

    const confirmation = confirmDelete(
      selectedCount === 1
        ? "Hide 1 selected asset? It will remain attached to posts but disappear from your library."
        : `Hide ${selectedCount} selected assets? They will remain attached to posts but disappear from your library.`,
    );
    if (!confirmation) return;

    setPendingAction("hide-selected");
    setPendingTag(null);
    setBanner(null);
    const assetIds = Array.from(selectedIds);

    startTransition(async () => {
      try {
        const result = await hideMediaAssets({ assetIds });
        applyHideResult(result, { label: "Selected assets", matchedCount: assetIds.length });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to hide selected assets.";
        setBanner({ tone: "error", message: description });
      } finally {
        setPendingAction(null);
        setPendingTag(null);
      }
    });
  };

  const handleHideTag = (tag: string, visibleCount: number) => {
    const confirmation = confirmDelete(
      `Hide every asset tagged #${tag}? This will hide ${visibleCount} shown here and any other assets with this tag.`,
    );
    if (!confirmation) return;

    setPendingAction("hide-tag");
    setPendingTag(tag);
    setBanner(null);

    startTransition(async () => {
      try {
        const result = await hideMediaAssetsByTag(tag);
        applyHideResult(result, { tag: result.tag, matchedCount: result.matchedCount });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to hide assets by tag.";
        setBanner({ tone: "error", message: description });
      } finally {
        setPendingAction(null);
        setPendingTag(null);
      }
    });
  };

  const handleHideUntaggedGroup = (assetIds: string[], visibleCount: number, tagLabel: string) => {
    if (!assetIds.length) return;
    const confirmation = confirmDelete(
      `Hide ${visibleCount} untagged asset${visibleCount === 1 ? "" : "s"}? They will remain attached to posts but disappear from your library.`,
    );
    if (!confirmation) return;

    setPendingAction("hide-group");
    setPendingTag(tagLabel);
    setBanner(null);

    startTransition(async () => {
      try {
        const result = await hideMediaAssets({ assetIds });
        applyHideResult(result, { label: "Untagged assets", matchedCount: assetIds.length });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to hide untagged assets.";
        setBanner({ tone: "error", message: description });
      } finally {
        setPendingAction(null);
        setPendingTag(null);
      }
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="space-y-6">
      {/* ---- Page header ---- */}
      <header className="space-y-1">
        <p className="eyebrow">Library</p>
        <h1 className="text-[22px] font-semibold leading-tight text-[var(--c-ink)]">
          {displayCount} asset{displayCount !== 1 ? "s" : ""}
        </h1>
        <p className="text-[14px] text-[var(--c-ink-2)]">
          Upload media assets and reuse them across campaigns and posts.
        </p>
      </header>

      {/* ---- Filter bar ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          options={FILTER_OPTIONS}
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as MediaTypeFilter)}
          size="sm"
        />

        {/* Tag pills */}
        {availableTags.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {availableTags.map((tag) => {
              const isActive = activeTagFilters.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTagFilter(tag)}
                  className={clsx(
                    "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition",
                    isActive
                      ? "border-[var(--c-orange)] bg-[var(--c-orange-soft)] text-[var(--c-orange)]"
                      : "border-[var(--c-line)] bg-[var(--c-card)] text-[var(--c-ink-3)] hover:border-[var(--c-line-2)] hover:text-[var(--c-ink-2)]",
                  )}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- Bulk actions bar ---- */}
      <div className="flex items-center justify-between rounded-[var(--r-lg)] border border-[var(--c-line)] bg-[var(--c-paper-2)] px-4 py-2.5 shadow-[var(--sh-sm)]">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-[var(--c-ink-2)]">
            {selectedCount} selected
          </span>
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="text-[11px] font-medium text-[var(--c-ink-3)] underline underline-offset-2 transition hover:text-[var(--c-ink)]"
              disabled={isPending}
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleHideSelected}
            className="inline-flex items-center gap-1 rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-ink-2)] transition hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!selectedCount || isPending}
          >
            {pendingAction === "hide-selected" && isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            <span>Hide</span>
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            className="inline-flex items-center gap-1 rounded-[var(--r-md)] bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!selectedCount || isPending}
          >
            {pendingAction === "selected" && isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* ---- Banner ---- */}
      {banner ? (
        <div
          className={clsx(
            "rounded-[var(--r-md)] border px-4 py-2.5 text-[13px] shadow-[var(--sh-sm)]",
            banner.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
            banner.tone === "error" && "border-rose-200 bg-rose-50 text-rose-700",
            banner.tone === "info" && "border-[var(--c-line)] bg-[var(--c-paper-2)] text-[var(--c-ink-2)]",
          )}
        >
          {banner.message}
        </div>
      ) : null}

      {/* ---- Upload progress ---- */}
      {uploading.length > 0 && (
        <div className="space-y-1.5">
          {uploading.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-3 py-2 text-[13px]"
            >
              <span className="truncate text-[var(--c-ink)]">{item.name}</span>
              <span className="ml-2 shrink-0 text-[11px] font-medium uppercase text-[var(--c-ink-3)]">
                {item.status === "uploading" && "Requesting slot"}
                {item.status === "processing" && "Uploading"}
                {item.status === "complete" && "Ready"}
                {item.status === "error" && "Failed"}
              </span>
              {item.error ? (
                <span className="text-[11px] text-rose-500">{item.error}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* ---- Grid (grouped by tag) ---- */}
      {filteredLibrary.length === 0 && library.length === 0 ? (
        <div className="rounded-[var(--r-lg)] border-[1.5px] border-dashed border-[var(--c-line-2)] p-8 text-center text-[13px] text-[var(--c-ink-3)]">
          Upload media to build your library. Once processed, derivatives (story, square, landscape) will appear here.
        </div>
      ) : (
        <div className="space-y-8">
          {tagGroups.map(({ tag, items, isUntagged }, groupIndex) => {
            const selectedInGroup = items.filter((asset) => selectedIds.has(asset.id)).length;
            const allSelected = selectedInGroup === items.length;
            const hideLabel = isUntagged ? "Hide group" : `Hide #${tag}`;
            const hideAction =
              isUntagged && items.length
                ? () => handleHideUntaggedGroup(items.map((asset) => asset.id), items.length, tag)
                : () => handleHideTag(tag, items.length);
            const isHidePending =
              (pendingAction === "hide-tag" || pendingAction === "hide-group") && pendingTag === tag && isPending;

            const gridContent = (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {/* Upload drop-zone tile (first group only) */}
                {groupIndex === 0 && (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={clsx(
                      "group/upload flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] border-[1.5px] border-dashed transition",
                      isDragging
                        ? "border-[var(--c-orange)] bg-[var(--c-orange-soft)]"
                        : "border-[var(--c-line-2)] bg-transparent hover:border-[var(--c-orange)] hover:bg-[var(--c-orange-soft)]",
                    )}
                  >
                    <Plus
                      className={clsx(
                        "h-5 w-5 transition",
                        isDragging
                          ? "text-[var(--c-orange)]"
                          : "text-[var(--c-ink-3)] group-hover/upload:text-[var(--c-orange)]",
                      )}
                    />
                    <span
                      className={clsx(
                        "text-[12px] transition",
                        isDragging
                          ? "text-[var(--c-orange)]"
                          : "text-[var(--c-ink-3)] group-hover/upload:text-[var(--c-orange)]",
                      )}
                    >
                      Drop or upload
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => void handleFiles(event.target.files)}
                    />
                  </div>
                )}

                {items.map((asset) => {
                  const statusLabel = STATUS_LABEL[asset.processedStatus];
                  const isSelected = selectedIds.has(asset.id);
                  // Usage count: count how many derived variants exist as a proxy
                  const usageCount = Object.keys(asset.derivedVariants ?? {}).length;

                  return (
                    <article
                      key={`${tag}-${asset.id}`}
                      className={clsx(
                        "overflow-hidden rounded-[var(--r-lg)] border bg-[var(--c-card)] transition",
                        isSelected
                          ? "border-[var(--c-orange)] ring-2 ring-[var(--c-orange)]/30"
                          : "border-[var(--c-line)]",
                      )}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-square w-full overflow-hidden bg-[var(--c-paper-2)]">
                        {/* Selection checkbox */}
                        <div className="absolute left-1.5 top-1.5 z-10">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleAssetSelection(asset.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 rounded border-[var(--c-line-2)] accent-[var(--c-orange)]"
                            aria-label={`Select ${asset.fileName}`}
                            disabled={isPending}
                          />
                        </div>

                        {/* Usage pill */}
                        {usageCount > 0 && (
                          <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-[var(--c-orange)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            Used {usageCount}
                          </span>
                        )}

                        {asset.previewUrl ? (
                          asset.mediaType === "video" ? (
                            <video
                              src={asset.previewUrl}
                              className="absolute inset-0 z-0 h-full w-full object-contain"
                              preload="metadata"
                              muted
                              controls={false}
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={asset.previewUrl}
                              alt={asset.fileName}
                              className="absolute inset-0 z-0 h-full w-full object-contain"
                              loading={groupIndex === 0 ? "eager" : "lazy"}
                            />
                          )
                        ) : (
                          <div className="absolute inset-0 z-0 flex items-center justify-center text-[var(--c-ink-4)]">
                            {MEDIA_TYPE_LABEL[asset.mediaType]}
                          </div>
                        )}

                        {/* Click to preview overlay */}
                        <button
                          type="button"
                          onClick={() => openAssetPreview(asset)}
                          disabled={isPending || !asset.previewUrl}
                          className="absolute inset-0 z-[1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-orange)]/50 enabled:cursor-zoom-in enabled:hover:bg-black/5 disabled:cursor-not-allowed"
                          aria-label={`Open preview for ${asset.fileName}`}
                        />
                      </div>

                      {/* Card footer */}
                      <div className="space-y-2 px-2.5 py-2">
                        {/* Label + editor */}
                        <MediaAssetEditor
                          asset={asset}
                          suppressRefresh
                          variant="compact"
                          onAssetUpdated={handleAssetUpdated}
                          onAssetDeleted={handleAssetDeleted}
                        />

                        {/* Tag micro-line */}
                        {asset.tags.length > 0 && (
                          <p className="truncate text-[11px] text-[var(--c-ink-3)]">
                            {asset.tags.map((t) => `#${t.trim()}`).join(" ")}
                          </p>
                        )}

                        {/* Status */}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[var(--c-ink-4)]">
                            {new Date(asset.uploadedAt).toLocaleDateString()}
                          </span>
                          <span className="text-[10px] font-medium uppercase text-[var(--c-ink-3)]">
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            );

            return (
              <section key={tag} className="space-y-3">
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-[var(--c-ink)]">
                      {isUntagged ? UNTITLED_TAG : `#${tag}`}{" "}
                      <span className="text-[12px] font-normal text-[var(--c-ink-3)]">{items.length}</span>
                    </h4>
                    {selectedInGroup > 0 && (
                      <span className="rounded-full bg-[var(--c-orange-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c-orange)]">
                        {selectedInGroup} selected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGroupSelection(items.map((asset) => asset.id))}
                      className="rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-ink-2)] transition hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isPending}
                    >
                      {allSelected ? "Clear group" : "Select group"}
                    </button>
                    <button
                      type="button"
                      onClick={hideAction}
                      className="inline-flex items-center gap-1 rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-ink-2)] transition hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isPending}
                    >
                      {isHidePending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5" />
                      )}
                      <span>{hideLabel}</span>
                    </button>
                  </div>
                </header>
                {/* First group renders immediately; subsequent groups lazy-load (PERF-04) */}
                {groupIndex === 0 ? gridContent : (
                  <LazyImageRow placeholderClassName="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {gridContent}
                  </LazyImageRow>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ---- Preview dialog ---- */}
      <Dialog open={previewOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-hidden border-[var(--c-line)] p-0">
          <DialogHeader className="gap-1 border-b border-[var(--c-line)] bg-[var(--c-card)] px-6 py-4 pr-14 text-left">
            <DialogTitle className="truncate text-[14px] font-semibold text-[var(--c-ink)]">
              {previewAsset?.fileName ?? "Media preview"}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-[var(--c-ink-3)]">
              {previewError
                ? previewError
                : previewAsset && !originalUrls[previewAsset.id] && isPreviewPending
                  ? "Loading full-size preview..."
                  : "Full-size preview"}
            </DialogDescription>
          </DialogHeader>

          <div className="relative flex max-h-[80vh] items-center justify-center overflow-auto bg-black/95 p-4">
            {previewAsset ? (
              originalUrls[previewAsset.id] || previewAsset.previewUrl ? (
                previewAsset.mediaType === "video" ? (
                  <video
                    src={originalUrls[previewAsset.id] ?? previewAsset.previewUrl}
                    className="max-h-[80vh] w-auto max-w-full"
                    preload="metadata"
                    controls
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={originalUrls[previewAsset.id] ?? previewAsset.previewUrl}
                    alt={previewAsset.fileName}
                    className="max-h-[80vh] w-auto max-w-full object-contain"
                  />
                )
              ) : (
                <p className="p-10 text-[13px] text-white/70">Preview unavailable.</p>
              )
            ) : null}

            {previewAsset && !originalUrls[previewAsset.id] && isPreviewPending ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
