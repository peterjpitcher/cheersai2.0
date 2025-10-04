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
        Upload media to build your library. Once processed, derivatives (story, square, landscape) will appear here with quick status updates.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {assets.map((asset) => {
        const statusStyle = STATUS_STYLE[asset.processedStatus];
        const statusLabel = STATUS_LABEL[asset.processedStatus];

        return (
          <article key={asset.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">{asset.fileName}</h4>
                <p className="text-xs text-slate-500">Uploaded {new Date(asset.uploadedAt).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {MEDIA_TYPE_LABEL[asset.mediaType]}
                </span>
                {formatSize(asset.sizeBytes) ? (
                  <p className="mt-1 text-[11px] text-slate-400">{formatSize(asset.sizeBytes)}</p>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {asset.tags.length ? (
                  asset.tags.map((tag) => (
                    <span
                      key={`${asset.id}-${tag}`}
                      className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-400">No tags yet</span>
                )}
              </div>
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase ${statusStyle}`}>
                {statusLabel}
              </span>
            </div>
            {asset.processedStatus === "ready" && Object.keys(asset.derivedVariants).length ? (
              <div className="mt-4 space-y-2">
                {Object.entries(asset.derivedVariants).map(([variant, path]) => (
                  <div
                    key={`${asset.id}-${variant}`}
                    className="flex items-center justify-between text-xs text-slate-600"
                  >
                    <span className="font-semibold uppercase">{variant}</span>
                    <a
                      href={`/storage/v1/object/${path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-slate-900 hover:underline"
                    >
                      Download
                    </a>
                  </div>
                ))}
              </div>
            ) : asset.processedStatus === "skipped" ? (
              <p className="mt-4 text-xs text-amber-700">
                Video derivatives are skipped for now. Use the original asset
                {" "}
                <a
                  href={`/storage/v1/object/${asset.storagePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-amber-800 hover:underline"
                >
                  download
                </a>
                {" "}or publish manually via the fallback kit.
              </p>
            ) : (
              <p className="mt-4 text-xs text-slate-500">
                Stored at <span className="font-mono">{asset.storagePath}</span>. FFmpeg derivatives queue will mark renditions when ready.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
