"use client";

import clsx from "clsx";
import { Loader2, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import {
  bulkDeleteMediaAssets,
  deleteMediaAssetsByTag,
  type BulkDeleteMediaAssetsResult,
  type DeleteByTagResult,
} from "@/app/(app)/library/actions";
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
  const [pendingAction, setPendingAction] = useState<"selected" | "tag" | "group" | null>(null);
  const [pendingTag, setPendingTag] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const tagGroups = useMemo(() => groupAssetsByTag(library), [library]);
  const selectedCount = selectedIds.size;

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
    result: BulkDeleteMediaAssetsResult & Partial<DeleteByTagResult>,
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

  const handleDeleteTag = (tag: string, visibleCount: number) => {
    const confirmation = confirmDelete(
      `Delete every asset tagged #${tag}? This will remove ${visibleCount} shown here and any other assets with this tag.`,
    );
    if (!confirmation) {
      return;
    }

    setPendingAction("tag");
    setPendingTag(tag);
    setBanner(null);

    startTransition(async () => {
      try {
        const result = await deleteMediaAssetsByTag(tag);
        applyBulkResult(result, { tag: result.tag, matchedCount: result.matchedCount });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to delete assets by tag.";
        setBanner({ tone: "error", message: description });
      } finally {
        setPendingAction(null);
        setPendingTag(null);
      }
    });
  };

  const handleDeleteUntaggedGroup = (assetIds: string[], visibleCount: number, tagLabel: string) => {
    if (!assetIds.length) return;
    const confirmation = confirmDelete(`Delete ${visibleCount} untagged asset${visibleCount === 1 ? "" : "s"}?`);
    if (!confirmation) {
      return;
    }
    setPendingAction("group");
    setPendingTag(tagLabel);
    setBanner(null);

    startTransition(async () => {
      try {
        const result = await bulkDeleteMediaAssets({ assetIds });
        applyBulkResult(result, { label: "Untagged assets", matchedCount: assetIds.length });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to delete untagged assets.";
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
            <p className="text-sm font-semibold text-slate-900">Bulk delete</p>
            <p className="text-xs text-slate-600">Tick multiple assets or clear an entire hashtag in one go.</p>
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
            const deleteLabel = isUntagged ? "Delete group" : `Delete #${tag}`;
            const deleteAction =
              isUntagged && items.length
                ? () => handleDeleteUntaggedGroup(items.map((asset) => asset.id), items.length, tag)
                : () => handleDeleteTag(tag, items.length);

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
                      onClick={deleteAction}
                      className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isPending}
                    >
                      {pendingAction !== null && pendingTag === tag && isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      <span>{deleteLabel}</span>
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
                              className="h-4 w-4 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
                              aria-label={`Select ${asset.fileName}`}
                              disabled={isPending}
                            />
                          </div>
                          {asset.previewUrl ? (
                            asset.mediaType === "video" ? (
                              <video
                                src={asset.previewUrl}
                                className="absolute inset-0 h-full w-full object-cover"
                                preload="metadata"
                                muted
                                controls={false}
                              />
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={asset.previewUrl}
                                alt={asset.fileName}
                                className="absolute inset-0 h-full w-full object-cover"
                                loading="lazy"
                              />
                            )
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-slate-500">
                              {MEDIA_TYPE_LABEL[asset.mediaType]}
                            </div>
                          )}
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
    </div>
  );
}
