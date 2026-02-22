import { PageHeader } from "@/components/layout/PageHeader";
import { BrandVoiceForm } from "@/features/settings/brand-voice-form";
import { PostingDefaultsForm } from "@/features/settings/posting-defaults-form";
import { ManagementConnectionForm } from "@/features/settings/management-connection-form";
import { LinkInBioSettingsSection } from "@/features/settings/link-in-bio";
import { getLinkInBioProfileWithTiles } from "@/lib/link-in-bio/profile";
import { listMediaAssets } from "@/lib/library/data";
import { getManagementConnectionSummary } from "@/lib/management-app/data";
import { getOwnerSettings } from "@/lib/settings/data";

export default async function SettingsPage() {
  const [settings, managementConnection, linkInBioData, mediaAssets] = await Promise.all([
    getOwnerSettings(),
    getManagementConnectionSummary(),
    getLinkInBioProfileWithTiles(),
    listMediaAssets(),
  ]);

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        title="Settings"
        description="Configure brand voice, posting defaults, and notification preferences."
      />

      <section className="glass-panel rounded-xl p-6 md:p-8 space-y-6">
        <div className="space-y-1">
          <h3 className="text-xl font-semibold text-brand-navy dark:text-white">Brand voice</h3>
          <p className="text-sm text-muted-foreground">
            Control tone, key phrases, and platform signatures that guide AI outputs.
          </p>
        </div>
        <BrandVoiceForm data={settings.brand} />
      </section>

      <section className="glass-panel rounded-xl p-6 md:p-8 space-y-6">
        <div className="space-y-1">
          <h3 className="text-xl font-semibold text-brand-navy dark:text-white">Posting defaults</h3>
          <p className="text-sm text-muted-foreground">
            Define scheduling rules, GBP CTA defaults, and email alerts for issues.
          </p>
        </div>
        <PostingDefaultsForm data={settings.posting} />
      </section>

      <section className="glass-panel rounded-xl p-6 md:p-8 space-y-6">
        <div className="space-y-1">
          <h3 className="text-xl font-semibold text-brand-navy dark:text-white">Management app connection</h3>
          <p className="text-sm text-muted-foreground">
            Configure the API credentials used to import event and promotion inputs into Create.
          </p>
        </div>
        <ManagementConnectionForm data={managementConnection} />
      </section>

      <div className="glass-panel rounded-xl p-6 md:p-8">
        <LinkInBioSettingsSection
          profile={linkInBioData.profile}
          tiles={linkInBioData.tiles}
          mediaAssets={mediaAssets}
        />
      </div>
    </div>
  );
}
