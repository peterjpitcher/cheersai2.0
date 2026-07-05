"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Upload } from "lucide-react";

import {
  finaliseMediaUpload,
  replaceMediaAssetEverywhere,
  requestMediaUpload,
} from "@/app/(app)/library/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/providers/toast-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { generateImageDerivatives } from "@/lib/library/client-derivatives";
import type { MediaAssetSummary } from "@/lib/library/data";
import { validateMediaFile } from "@/lib/media/upload";

interface MediaReplaceButtonProps {
  asset: MediaAssetSummary;
  onAssetReplaced?: (oldAssetId: string, replacement: MediaAssetSummary, options?: { hideOriginal: boolean }) => void;
}

type ProgressState = "idle" | "uploading" | "processing" | "saving";

export function MediaReplaceButton({ asset, onAssetReplaced }: MediaReplaceButtonProps) {
  const router = useRouter();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState>("idle");
  const [isPending, startTransition] = useTransition();

  if (asset.mediaType !== "image") {
    return null;
  }

  const isBusy = isPending || progress !== "idle";

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (!file || isBusy) {
      return;
    }

    const validationError = validateMediaFile(file);
    if (validationError) {
      setError(validationError.message);
      return;
    }

    setError(null);
    setProgress("uploading");

    startTransition(async () => {
      try {
        const { assetId, uploadUrl, storagePath, derivativeUploadUrls, mediaType } = await requestMediaUpload({
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        });

        if (mediaType !== "image") {
          throw new Error("Replacement must be an image.");
        }

        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        setProgress("processing");
        const { blobs, aspectClass } = await generateImageDerivatives(file);
        const uploadedVariants: Record<string, string> = {};

        for (const [variant, info] of Object.entries(derivativeUploadUrls ?? {})) {
          if (!info) continue;
          const blob = blobs[variant as keyof typeof blobs];
          if (!blob) continue;

          const derivativeResponse = await fetch(info.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": info.contentType },
            body: blob,
          });

          if (!derivativeResponse.ok) {
            throw new Error(`Derivative upload failed (${variant})`);
          }

          uploadedVariants[variant] = info.storagePath;
        }

        setProgress("saving");
        const replacement = await finaliseMediaUpload({
          assetId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          storagePath,
          derivedVariants: uploadedVariants,
          aspectClass,
          tags: asset.tags,
        });

        if (!replacement) {
          throw new Error("Replacement image could not be saved.");
        }

        const result = await replaceMediaAssetEverywhere({
          oldAssetId: asset.id,
          newAssetId: replacement.id,
        });

        const { counts } = result;
        const totalReferences =
          counts.variants +
          counts.attachments +
          counts.campaigns +
          counts.linkInBioProfiles +
          counts.linkInBioTiles +
          counts.tournamentsSquare +
          counts.tournamentsStory +
          counts.adSets +
          counts.ads;

        onAssetReplaced?.(asset.id, replacement, { hideOriginal: result.hidden });
        setOpen(false);

        if (result.hidden) {
          toast.success("Image replaced", {
            description:
              totalReferences > 0
                ? `Re-pointed ${totalReferences} reference${totalReferences === 1 ? "" : "s"} across your content.`
                : "No posts referenced the old image.",
          });
        } else if (totalReferences === 0) {
          toast.info("Replacement uploaded", {
            description: "No existing references used that exact image, so the old image was kept visible.",
          });
        } else {
          toast.error("Image replaced, but the old one was kept", {
            description: `${result.remainingReferences} planned-post reference${
              result.remainingReferences === 1 ? "" : "s"
            } could not be updated, so the old image stays in your library.`,
          });
        }

        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to replace image.");
      } finally {
        setProgress("idle");
      }
    });
  };

  const statusLabel =
    progress === "uploading"
      ? "Uploading"
      : progress === "processing"
        ? "Processing"
        : progress === "saving"
          ? "Saving"
          : "Choose image";

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={RefreshCw}
        full
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={`Replace image for ${asset.fileName}`}
      >
        Replace image
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => (!isBusy ? setOpen(nextOpen) : undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace image</DialogTitle>
            <DialogDescription>
              Upload a new image for {asset.fileName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              aria-label={`Replacement image for ${asset.fileName}`}
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] border-[1.5px] border-dashed border-[var(--c-line-2)] px-4 py-8 text-[13px] text-[var(--c-ink-3)] transition hover:border-[var(--c-orange)] hover:bg-[var(--c-orange-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              <span>{statusLabel}</span>
            </button>
            {error ? <p className="text-[12px] text-rose-600">{error}</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
