import { MediaAssetGrid } from "@/features/library/media-asset-grid";
import { UploadPanel } from "@/features/library/upload-panel";
import { PageHeader } from "@/components/layout/PageHeader";

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title="Library"
        description="Upload media assets, manage drafts, and prep prompt presets to reuse across campaigns."
      />

      <div className="rounded-xl border border-white/20 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm shadow-sm p-4 md:p-6 space-y-8">
        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">Upload media</h3>
            <p className="text-sm text-muted-foreground">
              Keep your brand assets together so posts and campaigns can reuse them quickly.
            </p>
          </div>
          <UploadPanel />
        </section>

        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">Recent uploads</h3>
            <p className="text-sm text-muted-foreground">Preview what’s available before you attach it to a campaign.</p>
          </div>
          <MediaAssetGrid />
        </section>
      </div>
    </div>
  );
}
