"use client";

import { useEffect, useMemo, useTransition, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";

import { updatePlannerContentMedia } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { MediaAssetInput } from "@/lib/create/schema";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";

interface PlannerContentMediaEditorProps {
  contentId: string;
  initialMedia: Array<{
    id: string;
    mediaType: "image" | "video";
    fileName: string | null;
  }>;
  mediaLibrary: MediaAssetSummary[];
  placement?: "feed" | "story";
  returnToPlannerAfterSave?: boolean;
  disableRouterRefresh?: boolean;
  onUpdated?: (contentId: string) => void;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
}

export function PlannerContentMediaEditor({
  contentId,
  initialMedia,
  mediaLibrary,
  placement = "feed",
  returnToPlannerAfterSave = false,
  disableRouterRefresh = false,
  onUpdated,
  onLibraryUpdate,
}: PlannerContentMediaEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaLibrary);
  const [selection, setSelection] = useState<MediaAssetInput[]>(
    initialMedia.map((media) => ({
      assetId: media.id,
      mediaType: media.mediaType,
      fileName: media.fileName ?? undefined,
    })),
  );
  const [shouldReturnToPlanner, setShouldReturnToPlanner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStory = placement === "story";
  // Assets already on the post when the editor opened. These may since have been
  // hidden in the library, so they can be kept without passing the library-based
  // pre-checks — the server re-validates authoritatively.
  const initiallyAttachedIds = useMemo(() => new Set(initialMedia.map((media) => media.id)), [initialMedia]);

  useEffect(() => {
    setLibrary(mediaLibrary);
  }, [mediaLibrary]);

  useEffect(() => {
    if (!shouldReturnToPlanner) return;
    const timeoutId = globalThis.setTimeout(() => {
      router.replace("/planner");
    }, 0);
    return () => globalThis.clearTimeout(timeoutId);
  }, [router, shouldReturnToPlanner]);

  const handleLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>> = (updater) => {
    setLibrary((prev) => (typeof updater === "function" ? (updater as (value: MediaAssetSummary[]) => MediaAssetSummary[])(prev) : updater));
    if (onLibraryUpdate) {
      onLibraryUpdate(updater);
    }
  };

  const handleSelectionChange = (next: MediaAssetInput[]) => {
    if (!isStory) {
      setSelection(next);
      setError(null);
      return;
    }

    setSelection((previous) => {
      const imagesOnly = next.filter((item) => item.mediaType === "image");
      let errorMessage: string | null = null;

      let finalSelection = imagesOnly;
      if (imagesOnly.length !== next.length) {
        errorMessage = "Stories support images only.";
      }

      if (imagesOnly.length > 1) {
        const added = imagesOnly.find((item) => !previous.some((prevItem) => prevItem.assetId === item.assetId));
        finalSelection = added ? [added] : imagesOnly.slice(0, 1);
        errorMessage = "Stories can only include one image.";
      }

      setError(errorMessage);

      if (!errorMessage && finalSelection.length === 0) {
        setError("Attach one image for this story.");
      }

      return finalSelection;
    });
  };

  const handleSave = () => {
    if (!selection.length) {
      setError("Attach at least one media asset before saving.");
      return;
    }

    if (isStory) {
      if (selection.length !== 1) {
        setError("Stories require exactly one image.");
        return;
      }
      const selectedId = selection[0]?.assetId;
      const asset = selectedId ? library.find((entry) => entry.id === selectedId) : undefined;
      if (!asset && !(selectedId && initiallyAttachedIds.has(selectedId))) {
        setError("Select a processed image from your library.");
        return;
      }
      if (asset && asset.mediaType !== "image") {
        setError("Stories support images only.");
        return;
      }
      if (asset && !asset.derivedVariants?.story) {
        setError("Story derivative still processing. Try again once ready.");
        return;
      }
    }

    setError(null);
    const toastId = toast.info("Updating media attachments…", { durationMs: 2000 });

    startTransition(async () => {
      try {
        await updatePlannerContentMedia({
          contentId,
          media: selection.map((item) => ({ assetId: item.assetId })),
        });
        toast.dismiss(toastId);
        toast.success("Media updated", {
          description: "Attachments will refresh in the planner view.",
        });
        if (returnToPlannerAfterSave) {
          setShouldReturnToPlanner(true);
          return;
        }
        if (!disableRouterRefresh) {
          router.refresh();
        }
        onUpdated?.(contentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update media";
        setError(message);
        toast.dismiss(toastId);
        toast.error("Media update failed", {
          description: message,
        });
      }
    });
  };

  return (
    <section className="space-y-4 rounded-xl border border-white/20 p-5 text-foreground shadow-sm backdrop-blur-sm" style={{ backgroundColor: 'var(--c-card)' }}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Manage attachments</h2>
          <p className="text-sm text-muted-foreground">Swap media before approving the draft. Uploads are available instantly.</p>
        </div>
      </header>
      <MediaAttachmentSelector
        assets={library}
        selected={selection}
        onChange={handleSelectionChange}
        label="Attachments"
        description="Select the assets this post should publish with."
        onLibraryUpdate={handleLibraryUpdate}
        emptyHint="Upload media to your Library and attach it here."
      />
      <p className="text-xs text-muted-foreground">
        {isStory
          ? "Stories publish a single 9:16 image. We’ll use the story derivative automatically."
          : "Posts require at least one attachment before publishing."}
      </p>
      {error ? <p className="text-xs text-rose-500">{error}</p> : null}
      <div
        className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-end border-t border-[var(--c-line)] px-5 py-3"
        style={{ backgroundColor: "var(--c-card)" }}
      >
        <Button type="button" onClick={handleSave} disabled={isPending} size="sm">
          {isPending ? "Saving…" : "Save media"}
        </Button>
      </div>
    </section>
  );
}
