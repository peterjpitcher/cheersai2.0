import { BrandVoiceForm } from "@/features/settings/brand-voice-form";
import { PostingDefaultsForm } from "@/features/settings/posting-defaults-form";
import { LinkInBioSettingsSection } from "@/features/settings/link-in-bio";
import { getLinkInBioProfileWithTiles } from "@/lib/link-in-bio/profile";
import { listMediaAssets } from "@/lib/library/data";
import { getOwnerSettings } from "@/lib/settings/data";

export default async function SettingsPage() {
  const [settings, linkInBioData, mediaAssets] = await Promise.all([
    getOwnerSettings(),
    getLinkInBioProfileWithTiles(),
    listMediaAssets(),
  ]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/15 bg-brand-teal px-6 py-5 text-white shadow-lg">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="mt-2 text-sm text-white/80">
          Configure brand voice, posting defaults, and notification preferences.
        </p>
      </section>
      <section className="space-y-6 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold">Brand voice</h3>
          <p className="text-sm text-brand-teal/70">
            Control tone, key phrases, and platform signatures that guide AI outputs.
          </p>
        </div>
        <BrandVoiceForm data={settings.brand} />
      </section>
      <section className="space-y-6 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold">Posting defaults</h3>
          <p className="text-sm text-brand-teal/70">
            Define scheduling rules, GBP CTA defaults, and email alerts for issues.
          </p>
        </div>
        <PostingDefaultsForm data={settings.posting} />
      </section>
      <LinkInBioSettingsSection
        profile={linkInBioData.profile}
        tiles={linkInBioData.tiles}
        mediaAssets={mediaAssets}
      />
    </div>
  );
}
