"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/components/providers/auth-provider";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { LinkInBioTile } from "@/lib/link-in-bio/types";
import { LINK_IN_BIO_MEDIA_TAG } from "@/lib/library/system-tags";
import {
  LinkInBioTileFormValues,
  linkInBioTileFormSchema,
} from "@/features/settings/schema";
import {
  removeLinkInBioTile,
  reorderLinkInBioTilesSettings,
  upsertLinkInBioTileSettings,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import {
  MediaFrameRawImage,
  MediaFrameVideo,
  resolveMediaPlacement,
} from "@/components/media/media-frame";
import { MediaUploadPanel } from "@/features/library/media-upload-panel";

interface LinkInBioTileManagerProps {
  tiles: LinkInBioTile[];
  mediaAssets: MediaAssetSummary[];
}

/* Shared style objects for design tokens */
const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-xl)",
  boxShadow: "var(--sh-xs)",
};

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-xl)",
  color: "var(--c-ink)",
  boxShadow: "var(--sh-xs)",
};

const formCardStyle: React.CSSProperties = {
  backgroundColor: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-2xl)",
  boxShadow: "var(--sh-md)",
};

function getAssetPlacement(asset: MediaAssetSummary) {
  return resolveMediaPlacement({ placement: asset.previewShape });
}

export function LinkInBioTileManager({ tiles, mediaAssets }: LinkInBioTileManagerProps) {
  const router = useRouter();
  const user = useAuth();
  const [isPending, startTransition] = useTransition();
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [libraryItems, setLibraryItems] = useState<MediaAssetSummary[]>(mediaAssets);

  useEffect(() => {
    setLibraryItems(mediaAssets);
  }, [mediaAssets]);

  const mediaById = useMemo(() => {
    const map = new Map<string, MediaAssetSummary>();
    for (const asset of libraryItems) {
      map.set(asset.id, asset);
    }
    return map;
  }, [libraryItems]);

  const sortedTiles = useMemo(
    () => [...tiles].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
    [tiles],
  );

  const activeTile = useMemo(() => sortedTiles.find((tile) => tile.id === activeTileId) ?? null, [sortedTiles, activeTileId]);

  const form = useForm<LinkInBioTileFormValues>({
    resolver: zodResolver(linkInBioTileFormSchema) as Resolver<LinkInBioTileFormValues>,
    defaultValues: {
      enabled: true,
    },
  });

  const selectedMediaAssetId = useWatch({ control: form.control, name: "mediaAssetId" });
  const selectedMedia = selectedMediaAssetId ? mediaById.get(selectedMediaAssetId) : undefined;

  const resetForm = () => {
    form.reset({
      id: undefined,
      title: "",
      subtitle: undefined,
      ctaLabel: "",
      ctaUrl: "",
      mediaAssetId: undefined,
      enabled: true,
    });
    setActiveTileId(null);
    setIsCreating(false);
  };

  const handleCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const handleEdit = (tileId: string) => {
    const tile = sortedTiles.find((item) => item.id === tileId);
    if (!tile) return;
    form.reset({
      id: tile.id,
      title: tile.title,
      subtitle: tile.subtitle ?? undefined,
      ctaLabel: tile.ctaLabel,
      ctaUrl: tile.ctaUrl,
      mediaAssetId: tile.mediaAssetId ?? undefined,
      enabled: tile.enabled,
    });
    setActiveTileId(tile.id);
    setIsCreating(false);
  };

  const handleSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      await upsertLinkInBioTileSettings(values);
      router.refresh();
      resetForm();
    });
  });

  const handleDelete = (tileId: string) => {
    startTransition(async () => {
      await removeLinkInBioTile(tileId);
      router.refresh();
      if (activeTileId === tileId) {
        resetForm();
      }
    });
  };

  const handleUploadedMedia = (asset: MediaAssetSummary) => {
    if (asset.mediaType !== "image") return;
    setLibraryItems((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    form.setValue("mediaAssetId", asset.id, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  };

  const clearSelectedMedia = () => {
    form.setValue("mediaAssetId", undefined, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  };

  const moveTile = (tileId: string, direction: "up" | "down") => {
    const index = sortedTiles.findIndex((tile) => tile.id === tileId);
    if (index === -1) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= sortedTiles.length) return;

    const reordered = [...sortedTiles];
    const [removed] = reordered.splice(index, 1);
    reordered.splice(target, 0, removed);

    startTransition(async () => {
      await reorderLinkInBioTilesSettings({ tileIds: reordered.map((tile) => tile.id) });
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>Always-on tiles</h4>
          <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
            Showcase evergreen offers or experiences. Tiles appear before scheduled campaigns on the public page.
          </p>
        </div>
        <Button type="button" onClick={handleCreate} size="sm">
          New tile
        </Button>
      </div>

      {sortedTiles.length === 0 ? (
        <p
          className="px-4 py-6 text-sm"
          style={{
            backgroundColor: "var(--c-paper)",
            border: "1px solid var(--c-line)",
            borderRadius: "var(--r-xl)",
            color: "var(--c-ink-3)",
          }}
        >
          No tiles yet. Create your first evergreen block to appear ahead of campaign posts.
        </p>
      ) : (
        <div className="space-y-3">
          {sortedTiles.map((tile, index) => {
            const media = tile.mediaAssetId ? mediaById.get(tile.mediaAssetId) : undefined;
            return (
            <div
              key={tile.id}
              className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
              style={cardStyle}
            >
              <div className="flex flex-1 items-start gap-3">
                {media ? (
                  media.previewUrl ? (
                    media.mediaType === "video" ? (
                      <MediaFrameVideo
                        src={media.previewUrl}
                        placement={getAssetPlacement(media)}
                        size="thumb"
                        className="mx-0 shrink-0 border-[var(--c-line)] bg-[var(--c-paper)]"
                      />
                    ) : (
                      <MediaFrameRawImage
                        src={media.previewUrl}
                        alt={media.fileName ?? tile.title}
                        placement={getAssetPlacement(media)}
                        size="thumb"
                        className="mx-0 shrink-0 border-[var(--c-line)] bg-[var(--c-paper)]"
                      />
                    )
                  ) : (
                    <div
                      className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden"
                      style={{
                        backgroundColor: "var(--c-paper)",
                        border: "1px solid var(--c-line)",
                        borderRadius: "var(--r-lg)",
                      }}
                    >
                      <span className="px-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--c-ink-3)" }}>
                        Preview pending
                      </span>
                    </div>
                  )
                ) : null}
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>{tile.title}</p>
                  {tile.subtitle ? <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>{tile.subtitle}</p> : null}
                  <p className="mt-1 break-all text-xs" style={{ color: "var(--c-ink-3)" }}>
                    {tile.ctaLabel} → {tile.ctaUrl}
                  </p>
                  {!tile.enabled ? (
                    <span
                      className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={{
                        backgroundColor: "var(--c-orange-soft)",
                        color: "var(--c-orange-hi)",
                      }}
                    >
                      Disabled
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={() => moveTile(tile.id, "up")}
                  disabled={isPending || index === 0}
                  size="sm"
                >
                  Up
                </Button>
                <Button
                  type="button"
                  onClick={() => moveTile(tile.id, "down")}
                  disabled={isPending || index === sortedTiles.length - 1}
                  size="sm"
                >
                  Down
                </Button>
                <Button
                  type="button"
                  onClick={() => handleEdit(tile.id)}
                  size="sm"
                  variant="outline"
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  onClick={() => handleDelete(tile.id)}
                  disabled={isPending}
                  size="sm"
                  variant="destructive"
                >
                  Delete
                </Button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {(isCreating || activeTile) && (
        <form
          onSubmit={handleSubmit}
          className="space-y-5 px-5 py-5"
          style={formCardStyle}
        >
          <div className="flex items-center justify-between">
            <h5 className="text-base font-semibold" style={{ color: "var(--c-ink)" }}>
              {isCreating ? "New tile" : `Edit tile: ${activeTile?.title ?? ""}`}
            </h5>
            <Button type="button" onClick={resetForm} size="sm" variant="outline">
              Cancel
            </Button>
          </div>
          <input type="hidden" {...form.register("id")} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Title</label>
              <input
                className="w-full px-3 py-2 text-sm focus:outline-none"
                style={inputStyle}
                {...form.register("title")}
              />
              {form.formState.errors.title ? (
                <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.title.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>CTA label</label>
              <input
                className="w-full px-3 py-2 text-sm focus:outline-none"
                style={inputStyle}
                placeholder="Book now"
                {...form.register("ctaLabel")}
              />
              {form.formState.errors.ctaLabel ? (
                <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.ctaLabel.message}</p>
              ) : null}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Subtitle</label>
              <input
                className="w-full px-3 py-2 text-sm focus:outline-none"
                style={inputStyle}
                placeholder="Optional supporting copy"
                {...form.register("subtitle")}
              />
              {form.formState.errors.subtitle ? (
                <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.subtitle.message}</p>
              ) : null}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>CTA link</label>
              <input
                className="w-full px-3 py-2 text-sm focus:outline-none"
                style={inputStyle}
                placeholder="https://"
                {...form.register("ctaUrl")}
              />
              {form.formState.errors.ctaUrl ? (
                <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.ctaUrl.message}</p>
              ) : null}
            </div>
            <div className="space-y-3 sm:col-span-2">
              <input type="hidden" {...form.register("mediaAssetId")} />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Tile image</label>
                  <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                    Upload a tile image. Tile images stay with the link-in-bio page and do not appear in the regular Library.
                  </p>
                </div>
                {selectedMedia ? (
                  <Button type="button" size="sm" variant="outline" onClick={clearSelectedMedia}>
                    Remove image
                  </Button>
                ) : null}
              </div>

              {selectedMedia ? (
                <div
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
                  style={{
                    backgroundColor: "var(--c-paper)",
                    border: "1px solid var(--c-line)",
                    borderRadius: "var(--r-xl)",
                  }}
                >
                  {selectedMedia.previewUrl ? (
                    selectedMedia.mediaType === "video" ? (
                      <MediaFrameVideo
                        src={selectedMedia.previewUrl}
                        placement={getAssetPlacement(selectedMedia)}
                        size="calendar"
                        className="mx-0 border-[var(--c-line)] bg-[var(--c-card)]"
                      />
                    ) : (
                      <MediaFrameRawImage
                        src={selectedMedia.previewUrl}
                        alt={selectedMedia.fileName ?? "Selected tile image"}
                        placement={getAssetPlacement(selectedMedia)}
                        size="calendar"
                        className="mx-0 border-[var(--c-line)] bg-[var(--c-card)]"
                      />
                    )
                  ) : (
                    <div
                      className="flex h-28 w-full items-center justify-center overflow-hidden sm:w-28"
                      style={{
                        backgroundColor: "var(--c-card)",
                        border: "1px solid var(--c-line)",
                        borderRadius: "var(--r-lg)",
                      }}
                    >
                      <span className="px-2 text-center text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--c-ink-3)" }}>
                        Preview pending
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
                      {selectedMedia.fileName}
                    </p>
                    <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                      Selected image
                    </p>
                  </div>
                </div>
              ) : null}

              <MediaUploadPanel
                accountId={user?.accountId ?? ""}
                onUploadComplete={handleUploadedMedia}
                showLibraryTab={false}
                showUrlTab={false}
                uploadTags={[LINK_IN_BIO_MEDIA_TAG]}
              />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="link-in-bio-tile-enabled" className="h-4 w-4" {...form.register("enabled")} />
              <label htmlFor="link-in-bio-tile-enabled" className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>
                Tile enabled
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={resetForm} size="sm" variant="outline">
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} size="sm">
              {isPending ? "Saving…" : "Save tile"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
