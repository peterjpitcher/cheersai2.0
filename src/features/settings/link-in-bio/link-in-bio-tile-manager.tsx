"use client";

import { useMemo, useState, useTransition } from "react";
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

interface LinkInBioTileManagerProps {
  tiles: LinkInBioTile[];
  mediaAssets: MediaAssetSummary[];
}

export function LinkInBioTileManager({ tiles, mediaAssets }: LinkInBioTileManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

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
      resetForm();
    });
  });

  const handleDelete = (tileId: string) => {
    startTransition(async () => {
      await removeLinkInBioTile(tileId);
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
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-lg font-semibold text-brand-teal">Always-on tiles</h4>
          <p className="text-sm text-brand-teal/70">
            Showcase evergreen offers or experiences. Tiles appear before scheduled campaigns on the public page.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="inline-flex items-center justify-center rounded-full border border-brand-teal bg-white px-4 py-2 text-sm font-semibold text-brand-teal shadow-sm transition hover:bg-brand-teal hover:text-white"
        >
          New tile
        </button>
      </div>

      {sortedTiles.length === 0 ? (
        <p className="rounded-xl border border-brand-teal/20 bg-white px-4 py-6 text-sm text-brand-teal/70">
          No tiles yet. Create your first evergreen block to appear ahead of campaign posts.
        </p>
      ) : (
        <div className="space-y-3">
          {sortedTiles.map((tile, index) => (
            <div
              key={tile.id}
              className="flex flex-col gap-3 rounded-xl border border-brand-teal/20 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-brand-teal">{tile.title}</p>
                {tile.subtitle ? <p className="text-xs text-brand-teal/70">{tile.subtitle}</p> : null}
                <p className="mt-1 text-xs text-brand-teal/60">{tile.ctaLabel} → {tile.ctaUrl}</p>
                {!tile.enabled ? (
                  <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                    Disabled
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => moveTile(tile.id, "up")}
                  disabled={isPending || index === 0}
                  className="rounded-full border border-brand-teal/40 px-3 py-1 text-xs font-semibold text-brand-teal transition hover:border-brand-teal disabled:opacity-40"
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => moveTile(tile.id, "down")}
                  disabled={isPending || index === sortedTiles.length - 1}
                  className="rounded-full border border-brand-teal/40 px-3 py-1 text-xs font-semibold text-brand-teal transition hover:border-brand-teal disabled:opacity-40"
                >
                  Down
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(tile.id)}
                  className="rounded-full border border-brand-teal bg-brand-teal px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-teal/90"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(tile.id)}
                  disabled={isPending}
                  className="rounded-full border border-red-400 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(isCreating || activeTile) && (
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border border-brand-teal/30 bg-white px-5 py-5 shadow-md"
        >
          <div className="flex items-center justify-between">
            <h5 className="text-base font-semibold text-brand-teal">
              {isCreating ? "New tile" : `Edit tile: ${activeTile?.title ?? ""}`}
            </h5>
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-semibold uppercase tracking-wide text-brand-teal/70 hover:text-brand-teal"
            >
              Cancel
            </button>
          </div>
          <input type="hidden" {...form.register("id")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-brand-teal">Title</label>
              <input
                className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal focus:border-brand-teal focus:outline-none"
                {...form.register("title")}
              />
              {form.formState.errors.title ? (
                <p className="text-xs text-red-600">{form.formState.errors.title.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-brand-teal">CTA label</label>
              <input
                className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal focus:border-brand-teal focus:outline-none"
                placeholder="Book now"
                {...form.register("ctaLabel")}
              />
              {form.formState.errors.ctaLabel ? (
                <p className="text-xs text-red-600">{form.formState.errors.ctaLabel.message}</p>
              ) : null}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-semibold text-brand-teal">Subtitle</label>
              <input
                className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal focus:border-brand-teal focus:outline-none"
                placeholder="Optional supporting copy"
                {...form.register("subtitle")}
              />
              {form.formState.errors.subtitle ? (
                <p className="text-xs text-red-600">{form.formState.errors.subtitle.message}</p>
              ) : null}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-semibold text-brand-teal">CTA link</label>
              <input
                className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal focus:border-brand-teal focus:outline-none"
                placeholder="https://"
                {...form.register("ctaUrl")}
              />
              {form.formState.errors.ctaUrl ? (
                <p className="text-xs text-red-600">{form.formState.errors.ctaUrl.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-brand-teal">Media (optional)</label>
              <select
                className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal focus:border-brand-teal focus:outline-none"
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
              <label htmlFor="link-in-bio-tile-enabled" className="text-sm font-medium text-brand-teal">
                Tile enabled
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-full border border-brand-teal/40 px-4 py-2 text-sm font-semibold text-brand-teal transition hover:border-brand-teal"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full bg-brand-teal px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isPending ? "Saving…" : "Save tile"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
