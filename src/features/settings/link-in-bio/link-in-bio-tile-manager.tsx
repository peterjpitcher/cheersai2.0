"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { LinkInBioTile } from "@/lib/link-in-bio/types";
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

interface LinkInBioTileManagerProps {
  tiles: LinkInBioTile[];
  mediaAssets: MediaAssetSummary[];
}

export function LinkInBioTileManager({ tiles, mediaAssets }: LinkInBioTileManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const mediaById = useMemo(() => {
    const map = new Map<string, MediaAssetSummary>();
    for (const asset of mediaAssets) {
      map.set(asset.id, asset);
    }
    return map;
  }, [mediaAssets]);

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
          <h4 className="text-lg font-semibold text-foreground">Always-on tiles</h4>
          <p className="text-sm text-muted-foreground">
            Showcase evergreen offers or experiences. Tiles appear before scheduled campaigns on the public page.
          </p>
        </div>
        <Button type="button" onClick={handleCreate} size="sm">
          New tile
        </Button>
      </div>

      {sortedTiles.length === 0 ? (
        <p className="rounded-xl border border-white/30 bg-white/70 px-4 py-6 text-sm text-muted-foreground backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/60">
          No tiles yet. Create your first evergreen block to appear ahead of campaign posts.
        </p>
      ) : (
        <div className="space-y-3">
          {sortedTiles.map((tile, index) => {
            const media = tile.mediaAssetId ? mediaById.get(tile.mediaAssetId) : undefined;
            return (
            <div
              key={tile.id}
              className="flex flex-col gap-4 rounded-xl border border-white/30 bg-white/80 px-4 py-4 shadow-sm backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/70 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex flex-1 items-start gap-3">
                {media ? (
                  <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/30 bg-white/50 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/60">
                    {media.previewUrl ? (
                      media.mediaType === "video" ? (
                        <video
                          src={media.previewUrl}
                          className="h-full w-full object-contain"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={media.previewUrl}
                          alt={media.fileName ?? tile.title}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      )
                    ) : (
                      <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Preview pending
                      </span>
                    )}
                  </div>
                ) : null}
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-foreground">{tile.title}</p>
                  {tile.subtitle ? <p className="text-xs text-muted-foreground">{tile.subtitle}</p> : null}
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {tile.ctaLabel} → {tile.ctaUrl}
                  </p>
                  {!tile.enabled ? (
                    <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
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
          className="space-y-5 rounded-2xl border border-white/30 bg-white/80 px-5 py-5 shadow-md backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/70"
        >
          <div className="flex items-center justify-between">
            <h5 className="text-base font-semibold text-foreground">
              {isCreating ? "New tile" : `Edit tile: ${activeTile?.title ?? ""}`}
            </h5>
            <Button type="button" onClick={resetForm} size="sm" variant="outline">
              Cancel
            </Button>
          </div>
          <input type="hidden" {...form.register("id")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Title</label>
              <input
                className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
                {...form.register("title")}
              />
              {form.formState.errors.title ? (
                <p className="text-xs text-red-600">{form.formState.errors.title.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">CTA label</label>
              <input
                className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
                placeholder="Book now"
                {...form.register("ctaLabel")}
              />
              {form.formState.errors.ctaLabel ? (
                <p className="text-xs text-red-600">{form.formState.errors.ctaLabel.message}</p>
              ) : null}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-semibold text-foreground">Subtitle</label>
              <input
                className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
                placeholder="Optional supporting copy"
                {...form.register("subtitle")}
              />
              {form.formState.errors.subtitle ? (
                <p className="text-xs text-red-600">{form.formState.errors.subtitle.message}</p>
              ) : null}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-semibold text-foreground">CTA link</label>
              <input
                className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
                placeholder="https://"
                {...form.register("ctaUrl")}
              />
              {form.formState.errors.ctaUrl ? (
                <p className="text-xs text-red-600">{form.formState.errors.ctaUrl.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Media (optional)</label>
              <select
                className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
                {...form.register("mediaAssetId")}
              >
                <option value="">No image</option>
                {mediaAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.fileName || asset.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="link-in-bio-tile-enabled" className="h-4 w-4" {...form.register("enabled")} />
              <label htmlFor="link-in-bio-tile-enabled" className="text-sm font-medium text-foreground">
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
