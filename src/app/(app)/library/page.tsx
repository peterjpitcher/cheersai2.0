import { MediaAssetGrid } from "@/features/library/media-asset-grid";
import { UploadPanel } from "@/features/library/upload-panel";

export default function LibraryPage() {
  return (
    <div className="space-y-8">
      <header className="rounded-2xl bg-brand-oat px-6 py-5 text-white shadow-md">
        <h2 className="text-3xl font-semibold">Library</h2>
        <p className="mt-2 text-sm text-white/80">
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
