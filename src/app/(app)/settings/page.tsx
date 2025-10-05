import { BrandVoiceForm } from "@/features/settings/brand-voice-form";
import { PostingDefaultsForm } from "@/features/settings/posting-defaults-form";
import { getOwnerSettings } from "@/lib/settings/data";

export default async function SettingsPage() {
  const settings = await getOwnerSettings();

  return (
    <div className="space-y-10 rounded-3xl border border-brand-mist/60 bg-brand-mist/20 p-8 shadow-lg">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-brand-teal">Settings</h2>
        <p className="text-brand-teal/70">
          Configure brand voice, posting defaults, and notification preferences.
        </p>
      </header>
      <section className="space-y-6 rounded-2xl border border-brand-mist/50 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold text-brand-teal">Brand voice</h3>
          <p className="text-sm text-brand-teal/70">
            Control tone, key phrases, and platform signatures that guide AI outputs.
          </p>
        </div>
        <BrandVoiceForm data={settings.brand} />
      </section>
      <section className="space-y-6 rounded-2xl border border-brand-mist/50 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold text-brand-teal">Posting defaults</h3>
          <p className="text-sm text-brand-teal/70">
            Define scheduling rules, GBP CTA defaults, and email alerts for issues.
          </p>
        </div>
        <PostingDefaultsForm data={settings.posting} />
      </section>
    </div>
  );
}
