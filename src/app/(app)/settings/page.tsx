import { BrandVoiceForm } from "@/features/settings/brand-voice-form";
import { PostingDefaultsForm } from "@/features/settings/posting-defaults-form";
import { getOwnerSettings } from "@/lib/settings/data";

export default async function SettingsPage() {
  const settings = await getOwnerSettings();

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-slate-900">Settings</h2>
        <p className="text-slate-600">
          Configure brand voice, posting defaults, and notification preferences.
        </p>
      </header>
      <section className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold text-slate-900">Brand voice</h3>
          <p className="text-sm text-slate-500">
            Control tone, key phrases, and platform signatures that guide AI outputs.
          </p>
        </div>
        <BrandVoiceForm data={settings.brand} />
      </section>
      <section className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold text-slate-900">Posting defaults</h3>
          <p className="text-sm text-slate-500">
            Define scheduling rules, GBP CTA defaults, and email alerts for issues.
          </p>
        </div>
        <PostingDefaultsForm data={settings.posting} />
      </section>
    </div>
  );
}
