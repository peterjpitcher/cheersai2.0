"use client";

import { Check, Image as ImageIcon, Video, X } from "lucide-react";
import { useMemo } from "react";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { MediaAssetInput } from "@/lib/create/schema";

const STATUS_BADGE: Record<MediaAssetSummary["processedStatus"], string> = {
  pending: "bg-slate-100 text-slate-600",
  processing: "bg-blue-100 text-blue-700",
  ready: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  skipped: "bg-amber-100 text-amber-700",
};

const STATUS_LABEL: Record<MediaAssetSummary["processedStatus"], string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  skipped: "Skipped",
};

interface MediaAttachmentSelectorProps {
  assets: MediaAssetSummary[];
  selected: MediaAssetInput[];
  onChange: (next: MediaAssetInput[]) => void;
  label: string;
  description?: string;
  emptyHint?: string;
}

export function MediaAttachmentSelector({
  assets,
  selected,
  onChange,
  label,
  description,
  emptyHint = "Upload media in the Library to attach it here.",
}: MediaAttachmentSelectorProps) {
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.assetId)), [selected]);

  const toggleAsset = (asset: MediaAssetSummary) => {
    if (selectedIds.has(asset.id)) {
      onChange(selected.filter((item) => item.assetId !== asset.id));
      return;
    }

    onChange([
      ...selected,
      {
        assetId: asset.id,
        mediaType: asset.mediaType,
        fileName: asset.fileName,
      },
    ]);
  };

  const removeAsset = (assetId: string) => {
    onChange(selected.filter((item) => item.assetId !== assetId));
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      </div>

      {selected.length ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((item) => {
            const asset = assets.find((entry) => entry.id === item.assetId);
            return (
              <span
                key={item.assetId}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
              >
                {asset?.mediaType === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                {asset?.fileName ?? item.fileName ?? item.assetId}
                <button
                  type="button"
                  onClick={() => removeAsset(item.assetId)}
                  className="rounded-full bg-white/80 p-1 text-slate-500 transition hover:text-slate-900"
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No media attached yet.</p>
      )}

      {assets.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {assets.map((asset) => {
            const isSelected = selectedIds.has(asset.id);
            const isReady = asset.processedStatus === "ready";
            const isSkipped = asset.processedStatus === "skipped";
            const Icon = asset.mediaType === "video" ? Video : ImageIcon;

            return (
              <article
                key={asset.id}
                className={`rounded-2xl border p-4 text-left transition ${
                  isSelected
                    ? "border-slate-900 bg-slate-900/5"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{asset.fileName}</p>
                      <p className="text-xs text-slate-500">
                        Uploaded {new Date(asset.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase ${
                      STATUS_BADGE[asset.processedStatus]
                    }`}
                  >
                    {STATUS_LABEL[asset.processedStatus]}
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    {isReady
                      ? "We’ll pick the best rendition for each platform."
                      : isSkipped
                        ? "Video derivatives are skipped automatically—download from the Library if you need a manual fallback."
                        : "Derivatives must finish processing before you can attach this."}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleAsset(asset)}
                    disabled={(!isReady && !isSelected) || isSkipped}
                    className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition ${
                      isSelected
                        ? "bg-slate-900 text-white hover:bg-slate-800"
                        : isReady
                          ? "border border-slate-300 text-slate-700 hover:border-slate-400"
                          : "border border-slate-200 text-slate-400"
                    } disabled:cursor-not-allowed`}
                  >
                    {isSelected ? <Check className="h-3 w-3" /> : null}
                    {isSelected ? "Attached" : isReady ? "Attach" : isSkipped ? "Unavailable" : "Processing"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          {emptyHint}
        </div>
      )}
    </div>
  );
}
