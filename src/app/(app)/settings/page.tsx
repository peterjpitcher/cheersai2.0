import { PageHeader } from "@/components/layout/PageHeader";
import { BrandVoiceForm } from "@/features/settings/brand-voice-form";
import { PostingDefaultsForm } from "@/features/settings/posting-defaults-form";
import { ManagementConnectionForm } from "@/features/settings/management-connection-form";
import { LinkInBioSettingsSection } from "@/features/settings/link-in-bio";
import { getLinkInBioProfileWithTiles } from "@/lib/link-in-bio/profile";
import { listMediaAssets } from "@/lib/library/data";
import { getManagementConnectionSummary } from "@/lib/management-app/data";
import { getOwnerSettings } from "@/lib/settings/data";
import { requireAuthContext } from "@/lib/auth/server";
import { listTeam } from "@/app/(app)/settings/team-actions";
import { TeamSection } from "@/features/settings/team-section";

export default async function SettingsPage() {
  // The management-app import is a per-brand switch, off by default.
  const { features, role } = await requireAuthContext();
  const [settings, managementConnection, linkInBioData, mediaAssets, team] = await Promise.all([
    getOwnerSettings(),
    features.managementImport ? getManagementConnectionSummary() : Promise.resolve(null),
    getLinkInBioProfileWithTiles(),
    listMediaAssets({ excludeTags: ["Tournament"], includeSystemAssets: true }),
    listTeam(),
  ]);

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        title="Settings"
        description="Configure brand voice, posting defaults, and notification preferences."
      />

      <section
        className="rounded-xl p-6 md:p-8 space-y-6"
        style={{
          backgroundColor: "var(--c-card)",
          border: "1px solid var(--c-line)",
          boxShadow: "var(--sh-sm)",
        }}
      >
        <div className="space-y-1">
          <h3 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>Brand voice</h3>
          <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
            Control tone, key phrases, and platform signatures that guide AI outputs.
          </p>
        </div>
        <BrandVoiceForm data={settings.brand} />
      </section>

      <section
        className="rounded-xl p-6 md:p-8 space-y-6"
        style={{
          backgroundColor: "var(--c-card)",
          border: "1px solid var(--c-line)",
          boxShadow: "var(--sh-sm)",
        }}
      >
        <div className="space-y-1">
          <h3 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>Posting defaults</h3>
          <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
            Define scheduling rules, banner defaults, and email alerts for issues.
          </p>
        </div>
        <PostingDefaultsForm data={settings.posting} />
      </section>

      <section
        id="team"
        className="rounded-xl p-6 md:p-8 space-y-6"
        style={{
          backgroundColor: "var(--c-card)",
          border: "1px solid var(--c-line)",
          boxShadow: "var(--sh-sm)",
        }}
      >
        <div className="space-y-1">
          <h3 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>Team</h3>
          <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
            Owners manage billing, people and connections. Members create and schedule posts.
          </p>
        </div>
        <TeamSection members={team} canManage={role === "owner"} />
      </section>

      {managementConnection ? (
      <section
        className="rounded-xl p-6 md:p-8 space-y-6"
        style={{
          backgroundColor: "var(--c-card)",
          border: "1px solid var(--c-line)",
          boxShadow: "var(--sh-sm)",
        }}
      >
        <div className="space-y-1">
          <h3 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>Management app connection</h3>
          <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
            Configure the API credentials used to import event and promotion inputs into Create.
          </p>
        </div>
        <ManagementConnectionForm data={managementConnection} />
      </section>
      ) : null}

      <div
        className="rounded-xl p-6 md:p-8"
        style={{
          backgroundColor: "var(--c-card)",
          border: "1px solid var(--c-line)",
          boxShadow: "var(--sh-sm)",
        }}
      >
        <LinkInBioSettingsSection
          profile={linkInBioData.profile}
          tiles={linkInBioData.tiles}
          mediaAssets={mediaAssets}
        />
      </div>
    </div>
  );
}
