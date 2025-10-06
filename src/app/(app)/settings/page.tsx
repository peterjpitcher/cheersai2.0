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
    <div className="space-y-8">
      <header className="rounded-2xl bg-brand-mist px-6 py-5 text-white shadow-md">
        <h2 className="text-3xl font-semibold">Settings</h2>
        <p className="mt-2 text-sm text-white/80">
          Configure brand voice, posting defaults, and notification preferences.
        </p>
      </header>
      <section className="space-y-6 rounded-2xl border border-brand-mist/40 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold text-brand-teal">Brand voice</h3>
          <p className="text-sm text-brand-teal/70">
            Control tone, key phrases, and platform signatures that guide AI outputs.
          </p>
        </div>
        <BrandVoiceForm data={settings.brand} />
      </section>
      <section className="space-y-6 rounded-2xl border border-brand-mist/40 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold text-brand-teal">Posting defaults</h3>
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
