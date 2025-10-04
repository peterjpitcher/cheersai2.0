import { MediaAssetGrid } from "@/features/library/media-asset-grid";
import { UploadPanel } from "@/features/library/upload-panel";

export default function LibraryPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-slate-900">Library</h2>
        <p className="text-slate-600">
          Upload media assets, manage drafts, and prepare prompt presets to reuse in campaigns.
        </p>
      </header>
      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">Upload media</h3>
        <UploadPanel />
      </section>
      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">Recent uploads</h3>
        <MediaAssetGrid />
      </section>
    </div>
  );
}
