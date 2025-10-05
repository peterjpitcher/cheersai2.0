import { MediaAssetGrid } from "@/features/library/media-asset-grid";
import { UploadPanel } from "@/features/library/upload-panel";

export default function LibraryPage() {
  return (
    <div className="space-y-10 rounded-3xl border border-brand-oat/40 bg-brand-oat/15 p-8 shadow-lg">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-brand-sandstone">Library</h2>
        <p className="text-brand-sandstone/70">
          Upload media assets, manage drafts, and prepare prompt presets to reuse in campaigns.
        </p>
      </header>
      <section className="space-y-4 rounded-2xl border border-brand-oat/40 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-brand-sandstone">Upload media</h3>
        <UploadPanel />
      </section>
      <section className="space-y-4 rounded-2xl border border-brand-oat/40 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-brand-sandstone">Recent uploads</h3>
        <MediaAssetGrid />
      </section>
    </div>
  );
}
