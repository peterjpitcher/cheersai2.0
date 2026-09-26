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
import { BillingSection, type CheckoutReturn } from "@/features/settings/billing-section";
import { BILLING_TRIAL_DAYS, billingPlanOptions, getBillingOverview } from "@/lib/billing/overview";

interface SettingsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readCheckoutReturn(value: string | string[] | undefined): CheckoutReturn {
  return value === "success" || value === "cancelled" ? value : null;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  // The management-app import is a per-brand switch, off by default.
  const { features, role, supabase, accountId } = await requireAuthContext();
  const params = searchParams ? await searchParams : {};
  const [settings, managementConnection, linkInBioData, mediaAssets, team, billing] = await Promise.all([
    getOwnerSettings(),
    features.managementImport ? getManagementConnectionSummary() : Promise.resolve(null),
    getLinkInBioProfileWithTiles(),
    listMediaAssets({ excludeTags: ["Tournament"], includeSystemAssets: true }),
    listTeam(),
    // A billing lookup failure shows an error in the Billing section, not a broken page.
    getBillingOverview(supabase, accountId).catch((error: unknown) => {
      console.error("[settings] billing overview failed", error);
      return null;
    }),
  ]);

  // Comped brands (our own venues) only ever see "Included, no
  // billing", so their Billing section sits at the bottom; for everyone else it
  // comes first, which is also where Checkout returns to.
  const billingFirst = billing?.state !== "comped";
  const billingSection = (
    <section
      id="billing"
      className="rounded-xl p-6 md:p-8 space-y-6"
      style={{
        backgroundColor: "var(--c-card)",
        border: "1px solid var(--c-line)",
        boxShadow: "var(--sh-sm)",
      }}
    >
      <div className="space-y-1">
        <h3 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>Billing</h3>
        <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>
          Your plan, payments and invoices. Prices exclude VAT.
        </p>
      </div>
      <BillingSection
        overview={billing}
        plans={billingPlanOptions()}
        canManage={role === "owner"}
        checkoutReturn={readCheckoutReturn(params.checkout)}
        trialDays={BILLING_TRIAL_DAYS}
      />
    </section>
  );

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        title="Settings"
        description="Configure brand voice, posting defaults, and notification preferences."
      />

      {billingFirst ? billingSection : null}

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

      {billingFirst ? null : billingSection}
    </div>
  );
}
