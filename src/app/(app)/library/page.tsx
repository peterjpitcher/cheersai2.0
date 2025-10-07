import { MediaAssetGrid } from "@/features/library/media-asset-grid";
import { UploadPanel } from "@/features/library/upload-panel";

export default function LibraryPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/15 bg-brand-teal px-6 py-5 text-white shadow-lg">
        <h2 className="text-2xl font-semibold">Library</h2>
        <p className="mt-2 text-sm text-white/80">
          Upload media assets, manage drafts, and prepare prompt presets to reuse in campaigns.
        </p>
      </section>
      <section className="space-y-4 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <h3 className="text-lg font-semibold">Upload media</h3>
        <UploadPanel />
      </section>
      <section className="space-y-4 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <h3 className="text-lg font-semibold">Recent uploads</h3>
        <MediaAssetGrid />
      </section>
    </div>
  );
}
