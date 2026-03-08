import { listMediaAssets } from '@/lib/library/data';
import { PageHeader } from '@/components/layout/PageHeader';
import { CampaignBriefForm } from '@/features/campaigns/CampaignBriefForm';

export default async function NewCampaignPage() {
  const mediaLibrary = await listMediaAssets();

  return (
    <div className="flex flex-col gap-6 font-sans">
      <PageHeader
        title="New Campaign"
        description="Describe your goal and let AI build your campaign strategy."
      />

      <div className="rounded-xl border border-white/20 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm shadow-sm p-4 md:p-6">
        <CampaignBriefForm mediaLibrary={mediaLibrary} />
      </div>
    </div>
  );
}
