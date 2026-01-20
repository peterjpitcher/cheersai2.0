"use client";

import clsx from "clsx";
import { EyeOff, Loader2, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import {
  bulkDeleteMediaAssets,
  fetchMediaAssetOriginalUrl,
  hideMediaAssets,
  hideMediaAssetsByTag,
  type BulkDeleteMediaAssetsResult,
  type HideByTagResult,
  type HideMediaAssetsResult,
} from "@/app/(app)/library/actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaAssetEditor } from "@/features/library/media-asset-editor";
import type { MediaAssetSummary } from "@/lib/library/data";

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

const STATUS_STYLE = {
  pending: "bg-slate-100 text-slate-600",
  processing: "bg-blue-100 text-blue-700",
  ready: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  skipped: "bg-amber-100 text-amber-700",
} as const;

const UNTITLED_TAG = "Untagged";

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

function formatSize(sizeBytes?: number) {
  if (!sizeBytes) return null;
  const mb = sizeBytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

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

export function MediaAssetGridClient({ assets }: { assets: MediaAssetSummary[] }) {
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

  const tagGroups = useMemo(() => groupAssetsByTag(library), [library]);
  const selectedCount = selectedIds.size;

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
    if (!confirmation) {
      return;
    }

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
    if (!confirmation) {
      return;
    }

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
    if (!confirmation) {
      return;
    }

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
    if (!confirmation) {
      return;
    }
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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold text-slate-900">Bulk actions</p>
            <p className="text-xs text-slate-600">Select multiple assets to delete or hide them from your library.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-teal">
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedCount || isPending}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleHideSelected}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedCount || isPending}
            >
              {pendingAction === "hide-selected" && isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
              <span>Hide selected</span>
            </button>
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedCount || isPending}
            >
              {pendingAction === "selected" && isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              <span>Delete selected</span>
            </button>
          </div>
        </div>
      </div>

      {banner ? (
        <div
          className={clsx(
            "rounded-lg border px-4 py-3 text-sm shadow-sm",
            banner.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
            banner.tone === "error" && "border-rose-200 bg-rose-50 text-rose-700",
            banner.tone === "info" && "border-slate-200 bg-slate-50 text-slate-700",
          )}
        >
          {banner.message}
        </div>
      ) : null}

      {library.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          Upload media to build your library. Once processed, derivatives (story, square, landscape) will appear here with quick
          status updates.
        </div>
      ) : (
        <div className="space-y-8">
          {tagGroups.map(({ tag, items, isUntagged }) => {
            const selectedInGroup = items.filter((asset) => selectedIds.has(asset.id)).length;
            const allSelected = selectedInGroup === items.length;
            const hideLabel = isUntagged ? "Hide group" : `Hide #${tag}`;
            const hideAction =
              isUntagged && items.length
                ? () => handleHideUntaggedGroup(items.map((asset) => asset.id), items.length, tag)
                : () => handleHideTag(tag, items.length);
            const isHidePending =
              (pendingAction === "hide-tag" || pendingAction === "hide-group") && pendingTag === tag && isPending;

            return (
              <section key={tag} className="space-y-3">
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-brand-teal">
                      {isUntagged ? UNTITLED_TAG : `#${tag}`}{" "}
                      <span className="text-xs text-brand-teal/60">{items.length}</span>
                    </h4>
                    {selectedInGroup ? (
                      <span className="rounded-full bg-brand-teal/10 px-2 py-0.5 text-[11px] font-semibold text-brand-teal">
                        {selectedInGroup} selected
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGroupSelection(items.map((asset) => asset.id))}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isPending}
                    >
                      {allSelected ? "Clear group" : "Select group"}
                    </button>
                    <button
                      type="button"
                      onClick={hideAction}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isPending}
                    >
                      {isHidePending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                      <span>{hideLabel}</span>
                    </button>
                  </div>
                </header>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {items.map((asset) => {
                    const statusStyle = STATUS_STYLE[asset.processedStatus];
                    const statusLabel = STATUS_LABEL[asset.processedStatus];
                    const isSelected = selectedIds.has(asset.id);

                    return (
                      <article
                        key={`${tag}-${asset.id}`}
                        className={clsx(
                          "space-y-3 rounded-2xl border bg-white p-3 text-xs text-slate-600 shadow-sm transition",
                          isSelected ? "border-brand-teal ring-2 ring-brand-teal/30" : "border-slate-200",
                        )}
                      >
                        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-100 bg-white">
                          <div className="absolute left-2 top-2 z-10">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleAssetSelection(asset.id)}
                              onClick={(event) => event.stopPropagation()}
                              className="h-4 w-4 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
                              aria-label={`Select ${asset.fileName}`}
                              disabled={isPending}
                            />
                          </div>
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
                                loading="lazy"
                              />
                            )
                          ) : (
                            <div className="absolute inset-0 z-0 flex items-center justify-center text-slate-500">
                              {MEDIA_TYPE_LABEL[asset.mediaType]}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => openAssetPreview(asset)}
                            disabled={isPending || !asset.previewUrl}
                            className="absolute inset-0 z-[1] rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/50 enabled:cursor-zoom-in enabled:hover:bg-black/5 disabled:cursor-not-allowed"
                            aria-label={`Open preview for ${asset.fileName}`}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                            {MEDIA_TYPE_LABEL[asset.mediaType]}
                          </span>
                          {formatSize(asset.sizeBytes) ? (
                            <span className="text-[10px] text-slate-400">{formatSize(asset.sizeBytes)}</span>
                          ) : null}
                        </div>
                        <MediaAssetEditor
                          asset={asset}
                          suppressRefresh
                          onAssetUpdated={handleAssetUpdated}
                          onAssetDeleted={handleAssetDeleted}
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-slate-500">
                            Uploaded {new Date(asset.uploadedAt).toLocaleDateString()}
                          </p>
                          <span
                            className={clsx(
                              "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                              statusStyle,
                            )}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={previewOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-hidden p-0">
          <DialogHeader className="gap-1 border-b border-slate-200 bg-white px-6 py-4 pr-14 text-left">
            <DialogTitle className="truncate text-sm font-semibold text-slate-900">
              {previewAsset?.fileName ?? "Media preview"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {previewError
                ? previewError
                : previewAsset && !originalUrls[previewAsset.id] && isPreviewPending
                  ? "Loading full-size preview…"
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
                <p className="p-10 text-sm text-white/70">Preview unavailable.</p>
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
