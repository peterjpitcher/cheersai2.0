"use client";

import clsx from "clsx";
import { Check, EyeOff, Image as ImageIcon, Loader2, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";

import { hideMediaAssets, hideMediaAssetsByTag } from "@/app/(app)/library/actions";
import { MediaAssetEditor } from "@/features/library/media-asset-editor";
import { groupMediaAssetsByTag, UNTITLED_MEDIA_TAG } from "@/features/library/media-groups";
import type { MediaAssetSummary } from "@/lib/library/data";

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

type BannerState = { tone: "success" | "error" | "info"; message: string };

interface MediaLibraryPickerGridProps {
  items: MediaAssetSummary[];
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onItemsChange?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  onAssetUpdated?: (asset: MediaAssetSummary) => void;
  onAssetRemoved?: (assetId: string) => void;
  emptyHint?: string;
  selectLabel?: string;
  selectedLabel?: string;
  getPreviewUrl?: (asset: MediaAssetSummary) => string | undefined;
  isAssetSelectable?: (asset: MediaAssetSummary) => boolean;
  getUnavailableLabel?: (asset: MediaAssetSummary) => string | null;
}

export function MediaLibraryPickerGrid({
  items,
  selectedIds = [],
  onSelectionChange,
  onItemsChange,
  onAssetUpdated,
  onAssetRemoved,
  emptyHint = "No media uploaded yet. Upload your first image to get started.",
  selectLabel = "Select",
  selectedLabel = "Selected",
  getPreviewUrl,
  isAssetSelectable = () => true,
  getUnavailableLabel,
}: MediaLibraryPickerGridProps) {
  const [library, setLibrary] = useState<MediaAssetSummary[]>(items);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setLibrary(items);
  }, [items]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const groupedAssets = useMemo(() => groupMediaAssetsByTag(library), [library]);

  const updateItems = useCallback(
    (updater: SetStateAction<MediaAssetSummary[]>) => {
      setLibrary(updater);
      onItemsChange?.(updater);
    },
    [onItemsChange],
  );

  const applySelection = useCallback(
    (ids: string[]) => {
      onSelectionChange?.(Array.from(new Set(ids)));
    },
    [onSelectionChange],
  );

  const toggleAssetSelection = (asset: MediaAssetSummary) => {
    if (!isAssetSelectable(asset)) return;
    const next = selectedSet.has(asset.id)
      ? selectedIds.filter((id) => id !== asset.id)
      : [...selectedIds, asset.id];
    applySelection(next);
  };

  const toggleGroupSelection = (assets: MediaAssetSummary[]) => {
    const selectableIds = assets.filter(isAssetSelectable).map((asset) => asset.id);
    if (!selectableIds.length) return;

    const isFullySelected = selectableIds.every((id) => selectedSet.has(id));
    const groupSet = new Set(selectableIds);
    const next = isFullySelected
      ? selectedIds.filter((id) => !groupSet.has(id))
      : [...selectedIds, ...selectableIds.filter((id) => !selectedSet.has(id))];

    applySelection(next);
  };

  const handleAssetUpdated = (updated: MediaAssetSummary) => {
    updateItems((prev) => prev.map((asset) => (asset.id === updated.id ? { ...asset, ...updated } : asset)));
    onAssetUpdated?.(updated);
  };

  const handleAssetDeleted = (assetId: string) => {
    updateItems((prev) => prev.filter((asset) => asset.id !== assetId));
    if (selectedSet.has(assetId)) {
      applySelection(selectedIds.filter((id) => id !== assetId));
    }
    onAssetRemoved?.(assetId);
    setBanner({ tone: "success", message: "Media deleted" });
  };

  const applyHiddenIds = (assetIds: string[]) => {
    const hiddenIds = new Set(assetIds);
    if (!hiddenIds.size) return;

    updateItems((prev) => prev.filter((asset) => !hiddenIds.has(asset.id)));
    const nextSelection = selectedIds.filter((id) => !hiddenIds.has(id));
    if (nextSelection.length !== selectedIds.length) {
      applySelection(nextSelection);
    }
    for (const id of hiddenIds) {
      onAssetRemoved?.(id);
    }
  };

  const hideAssets = ({
    assetIds,
    label,
    confirmation,
  }: {
    assetIds: string[];
    label: string;
    confirmation: string;
  }) => {
    if (!assetIds.length) return;
    if (typeof window !== "undefined" && !window.confirm(confirmation)) return;

    const actionKey = `hide:${label}`;
    setPendingAction(actionKey);
    setBanner(null);

    startTransition(async () => {
      try {
        const result = await hideMediaAssets({ assetIds });
        applyHiddenIds(result.hiddenIds);
        const tone: BannerState["tone"] = result.hiddenIds.length ? "success" : "info";
        const messageParts = [`${label} hidden ${result.hiddenIds.length}`];
        if (result.notFound.length) {
          messageParts.push(`${result.notFound.length} missing`);
        }
        setBanner({ tone, message: messageParts.join(" · ") });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to hide media.";
        setBanner({ tone: "error", message: description });
      } finally {
        setPendingAction(null);
      }
    });
  };

  const hideTag = (tag: string, visibleIds: string[]) => {
    if (!visibleIds.length) return;
    if (tag === UNTITLED_MEDIA_TAG) {
      hideAssets({
        assetIds: visibleIds,
        label: "Untagged assets",
        confirmation: `Hide ${visibleIds.length} untagged asset${visibleIds.length === 1 ? "" : "s"}? They will remain attached to posts but disappear from your library.`,
      });
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(`Hide every asset tagged #${tag}? This will hide ${visibleIds.length} shown here and any other assets with this tag.`)
    ) {
      return;
    }

    const actionKey = `hide-tag:${tag}`;
    setPendingAction(actionKey);
    setBanner(null);

    startTransition(async () => {
      try {
        const result = await hideMediaAssetsByTag(tag);
        applyHiddenIds(result.hiddenIds);
        const tone: BannerState["tone"] = result.hiddenIds.length ? "success" : "info";
        setBanner({
          tone,
          message: `Tag #${result.tag} · Hidden ${result.hiddenIds.length}${result.notFound.length ? ` · ${result.notFound.length} missing` : ""}`,
        });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Unable to hide assets by tag.";
        setBanner({ tone: "error", message: description });
      } finally {
        setPendingAction(null);
      }
    });
  };

  if (!library.length) {
    return (
      <div className="rounded-[var(--r-lg)] border-[1.5px] border-dashed border-[var(--c-line-2)] p-8 text-center">
        <p className="text-[13px] text-[var(--c-ink-3)]">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {banner ? (
        <div
          className={clsx(
            "rounded-[var(--r-md)] border px-4 py-2.5 text-[13px]",
            banner.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
            banner.tone === "error" && "border-rose-200 bg-rose-50 text-rose-700",
            banner.tone === "info" && "border-[var(--c-line)] bg-[var(--c-paper-2)] text-[var(--c-ink-2)]",
          )}
        >
          {banner.message}
        </div>
      ) : null}

      {groupedAssets.map(({ tag, items: groupItems, isUntagged }) => {
        const selectedInGroup = groupItems.filter((asset) => selectedSet.has(asset.id)).length;
        const selectableItems = groupItems.filter(isAssetSelectable);
        const allSelected = selectableItems.length > 0 && selectableItems.every((asset) => selectedSet.has(asset.id));
        const groupAssetIds = groupItems.map((asset) => asset.id);
        const hideActionKey = isUntagged ? "hide:Untagged assets" : `hide-tag:${tag}`;

        return (
          <section key={tag} className="space-y-3">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h4 className="text-[13px] font-semibold text-[var(--c-ink)]">
                  {isUntagged ? UNTITLED_MEDIA_TAG : `#${tag}`}{" "}
                  <span className="text-[12px] font-normal text-[var(--c-ink-3)]">{groupItems.length}</span>
                </h4>
                {selectedInGroup > 0 ? (
                  <span className="rounded-full bg-[var(--c-orange-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c-orange)]">
                    {selectedInGroup} selected
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleGroupSelection(groupItems)}
                  className="rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-ink-2)] transition hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!onSelectionChange || !selectableItems.length || isPending}
                >
                  {allSelected ? "Clear group" : "Select group"}
                </button>
                <button
                  type="button"
                  onClick={() => hideTag(tag, groupAssetIds)}
                  className="inline-flex items-center gap-1 rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-ink-2)] transition hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isPending}
                >
                  {pendingAction === hideActionKey && isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                  <span>{isUntagged ? "Hide group" : `Hide #${tag}`}</span>
                </button>
              </div>
            </header>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {groupItems.map((asset) => {
                const isSelected = selectedSet.has(asset.id);
                const isSelectable = isAssetSelectable(asset);
                const unavailableLabel = isSelectable ? null : getUnavailableLabel?.(asset) ?? "Unavailable";
                const previewSrc = getPreviewUrl?.(asset) ?? asset.previewUrl;

                return (
                  <article
                    key={`${tag}-${asset.id}`}
                    className={clsx(
                      "min-w-0 overflow-hidden rounded-[var(--r-lg)] border bg-[var(--c-card)] text-left transition",
                      isSelected
                        ? "border-[var(--c-orange)] ring-2 ring-[var(--c-orange)]/30"
                        : "border-[var(--c-line)] hover:border-[var(--c-line-2)]",
                    )}
                  >
                    <div className="relative aspect-square w-full overflow-hidden bg-[var(--c-paper-2)]">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          hideAssets({
                            assetIds: [asset.id],
                            label: asset.fileName,
                            confirmation: `Hide "${asset.fileName}"? It will remain attached to posts but disappear from your library.`,
                          });
                        }}
                        className="absolute right-1.5 top-1.5 z-20 rounded-full border border-[var(--c-line)] bg-[var(--c-card)]/90 p-1 text-[var(--c-ink-3)] shadow-sm transition hover:text-[var(--c-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isPending}
                        aria-label={`Hide ${asset.fileName}`}
                        title={`Hide ${asset.fileName}`}
                      >
                        {pendingAction === `hide:${asset.fileName}` && isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                        <EyeOff className="h-3.5 w-3.5" />
                      )}
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleAssetSelection(asset)}
                        disabled={!onSelectionChange || !isSelectable}
                        aria-pressed={isSelected}
                        className={clsx(
                          "absolute inset-0 z-10 flex h-full w-full items-center justify-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-orange)]/50",
                          onSelectionChange && isSelectable
                            ? "cursor-pointer hover:bg-black/5"
                            : "cursor-not-allowed opacity-75",
                        )}
                      >
                        <span
                          className={clsx(
                            "absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded border transition",
                            isSelected
                              ? "border-[var(--c-orange)] bg-[var(--c-orange)] text-white"
                              : "border-[var(--c-line-2)] bg-[var(--c-card)]/85 text-transparent",
                          )}
                        >
                          {isSelected ? <Check className="h-3 w-3" /> : null}
                        </span>

                        {previewSrc ? (
                          asset.mediaType === "video" ? (
                            <video
                              src={previewSrc}
                              className="absolute inset-0 z-0 h-full w-full object-contain"
                              preload="metadata"
                              muted
                              controls={false}
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewSrc}
                              alt={asset.fileName}
                              className="absolute inset-0 z-0 h-full w-full object-contain"
                              loading="lazy"
                            />
                          )
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--c-ink-4)]">
                            {asset.mediaType === "video" ? <Video className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                          </div>
                        )}
                      </button>
                    </div>

                    <div className="space-y-2 px-2.5 py-2">
                      <div className="flex items-center justify-between text-[10px] text-[var(--c-ink-3)]">
                        <span className="inline-flex items-center justify-center rounded-full border border-[var(--c-line)] bg-[var(--c-card)] p-1.5">
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
                          onSelectionChange ? (
                            <button
                              type="button"
                              onClick={() => toggleAssetSelection(asset)}
                              disabled={!isSelectable}
                              className="inline-flex w-full items-center justify-center gap-1 rounded-[var(--r-md)] border border-[var(--c-line)] bg-[var(--c-card)] px-3 py-1.5 text-[11px] font-semibold text-[var(--c-ink-2)] transition hover:border-[var(--c-line-2)] hover:text-[var(--c-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label={isSelected ? `Deselect ${asset.fileName}` : `Select ${asset.fileName}`}
                            >
                              {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                              <span>{isSelected ? selectedLabel : selectLabel}</span>
                            </button>
                          ) : null
                        }
                      />
                      {unavailableLabel ? <p className="text-[10px] font-medium text-[var(--c-ink-3)]">{unavailableLabel}</p> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
