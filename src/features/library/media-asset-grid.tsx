import clsx from "clsx";

import { MediaAssetEditor } from "@/features/library/media-asset-editor";
import { listMediaAssets } from "@/lib/library/data";

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

function formatSize(sizeBytes?: number) {
  if (!sizeBytes) return null;
  const mb = sizeBytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

export async function MediaAssetGrid() {
  const assets = await listMediaAssets();

  if (!assets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
        Upload media to build your library. Once processed, derivatives (story, square, landscape) will appear here with quick
        status updates.
      </div>
    );
  }

  const tagGroups = new Map<string, typeof assets>();
  for (const asset of assets) {
    const tags = asset.tags.length ? asset.tags : [UNTITLED_TAG];
    for (const rawTag of tags) {
      const key = rawTag.trim().length ? rawTag.trim() : UNTITLED_TAG;
      const bucket = tagGroups.get(key) ?? [];
      bucket.push(asset);
      tagGroups.set(key, bucket);
    }
  }

  const sortedGroups = Array.from(tagGroups.entries()).sort(([a], [b]) => {
    if (a === UNTITLED_TAG) return 1;
    if (b === UNTITLED_TAG) return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });

  return (
    <div className="space-y-8">
      {sortedGroups.map(([tag, items]) => (
        <section key={tag} className="space-y-3">
          <header className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-brand-teal">
              {tag === UNTITLED_TAG ? UNTITLED_TAG : `#${tag}`} <span className="text-xs text-brand-teal/60">{items.length}</span>
            </h4>
          </header>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {items.map((asset) => {
              const statusStyle = STATUS_STYLE[asset.processedStatus];
              const statusLabel = STATUS_LABEL[asset.processedStatus];

              return (
                <article
                  key={`${tag}-${asset.id}`}
                  className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-100 bg-white">
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
                  <MediaAssetEditor asset={asset} />
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-slate-500">Uploaded {new Date(asset.uploadedAt).toLocaleDateString()}</p>
                    <span className={clsx("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", statusStyle)}>
                      {statusLabel}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
