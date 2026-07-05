"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { loadPlannerMediaLibrary } from "@/app/(app)/planner/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { PlannerContentMediaEditor } from "@/features/planner/content-media-editor";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";

type PlannerEditorMedia = Array<{
  id: string;
  mediaType: "image" | "video";
  fileName: string | null;
}>;

interface PlannerMediaSwapButtonProps {
  contentId: string;
  initialMedia: PlannerEditorMedia;
  placement: PlannerContentDetail["placement"];
  disabled?: boolean;
  buttonLabel?: string;
  ariaLabel?: string;
  buttonVariant?: ButtonProps["variant"];
  buttonSize?: ButtonProps["size"];
  className?: string;
  title?: string | null;
  initialMediaLibrary?: MediaAssetSummary[];
  onUpdated?: (contentId: string) => void | Promise<void>;
}

export function PlannerMediaSwapButton({
  contentId,
  initialMedia,
  placement,
  disabled = false,
  buttonLabel = "Edit",
  ariaLabel,
  buttonVariant = "ghost",
  buttonSize = "sm",
  className,
  title,
  initialMediaLibrary,
  onUpdated,
}: PlannerMediaSwapButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [library, setLibrary] = useState<MediaAssetSummary[] | null>(initialMediaLibrary ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadPending, startLoadTransition] = useTransition();
  const attachedAssetIds = useMemo(() => initialMedia.map((media) => media.id), [initialMedia]);

  useEffect(() => {
    if (initialMediaLibrary) {
      setLibrary(initialMediaLibrary);
    }
  }, [initialMediaLibrary]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [isOpen]);

  const loadLibrary = useCallback(() => {
    const hasAttachedAssets =
      attachedAssetIds.length === 0 || attachedAssetIds.every((assetId) => library?.some((asset) => asset.id === assetId));
    if ((library && hasAttachedAssets) || isLoading) return;
    setIsLoading(true);
    setLoadError(null);
    startLoadTransition(async () => {
      try {
        const assets = await loadPlannerMediaLibrary({ includeAssetIds: attachedAssetIds });
        setLibrary(assets);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load media library.";
        setLoadError(message);
      } finally {
        setIsLoading(false);
      }
    });
  }, [attachedAssetIds, isLoading, library]);

  const openEditor = () => {
    setIsOpen(true);
    loadLibrary();
  };

  const handleLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>> = useCallback((updater) => {
    setLibrary((current) => {
      const existing = current ?? [];
      return typeof updater === "function" ? (updater as (value: MediaAssetSummary[]) => MediaAssetSummary[])(existing) : updater;
    });
  }, []);

  const handleUpdated = useCallback(
    (updatedContentId: string) => {
      setIsOpen(false);
      const result = onUpdated?.(updatedContentId);
      if (!onUpdated) {
        router.refresh();
      } else if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((error) => {
          console.error("[planner] media refresh failed", error);
        });
      }
    },
    [onUpdated, router],
  );

  const portalRoot = typeof document === "undefined" ? null : document.body;
  const modalTitle = title ?? "Planned post";

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size={buttonSize}
        onClick={openEditor}
        disabled={disabled || isLoading || isLoadPending}
        className={className}
        icon={Pencil}
        aria-label={ariaLabel ?? buttonLabel}
      >
        {buttonLabel}
      </Button>

      {isOpen && portalRoot
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-hidden p-4" role="dialog" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 z-0 bg-slate-900/60 backdrop-blur-sm"
                aria-label="Close media editor"
                onClick={() => setIsOpen(false)}
              />
              <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/40 bg-white shadow-2xl">
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Media editor</p>
                    <h2 className="text-lg font-semibold text-slate-900">{modalTitle}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="rounded-full border border-slate-300 p-1.5 text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
                    aria-label="Close media editor"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  {isLoading || isLoadPending ? (
                    <p className="text-sm text-slate-500">Loading media library...</p>
                  ) : loadError ? (
                    <div className="space-y-3">
                      <p className="text-sm text-rose-600">{loadError}</p>
                      <Button type="button" variant="secondary" size="sm" onClick={loadLibrary}>
                        Try again
                      </Button>
                    </div>
                  ) : (
                    <PlannerContentMediaEditor
                      contentId={contentId}
                      initialMedia={initialMedia}
                      mediaLibrary={library ?? []}
                      placement={placement}
                      returnToPlannerAfterSave={false}
                      disableRouterRefresh
                      onUpdated={handleUpdated}
                      onLibraryUpdate={handleLibraryUpdate}
                    />
                  )}
                </div>
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}
