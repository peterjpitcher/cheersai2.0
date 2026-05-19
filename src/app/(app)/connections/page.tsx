import { Suspense } from "react";

import { getAdAccountSetupStatus } from "@/app/(app)/connections/actions-ads";
import { featureFlags } from "@/env";
import { ConnectionCards } from "@/features/connections/connection-cards";
import { ConnectionDiagnostics } from "@/features/connections/connection-diagnostics";
import { ConnectionOAuthHandler } from "@/features/connections/connection-oauth-handler";
import { AdAccountSetup } from "@/features/campaigns/AdAccountSetup";
import { PageHeader } from "@/components/layout/PageHeader";

export default async function ConnectionsPage() {
  const adAccountStatus = await getAdAccountSetupStatus();

  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title="Connections"
        description="Keep tokens healthy, understand provider limits, and react quickly to expiring access."
      />

      <div
        className="rounded-xl p-4 md:p-6 space-y-8"
        style={{
          backgroundColor: "var(--c-card)",
          border: "1px solid var(--c-line)",
          boxShadow: "var(--sh-sm)",
        }}
      >
        <Suspense fallback={null}>
          <ConnectionOAuthHandler />
        </Suspense>

        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>Connected accounts</h3>
            <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>Status, tokens, and reconnect controls for each provider.</p>
          </div>
          <ConnectionCards />
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>Meta Ads (Campaigns)</h3>
            <p className="text-sm" style={{ color: "var(--c-ink-3)" }}>Connect your Meta Ads account to create and manage paid campaigns.</p>
          </div>
          <Suspense fallback={null}>
            <AdAccountSetup initialStatus={adAccountStatus} />
          </Suspense>
        </section>

        <section
          className="space-y-2 rounded-lg p-4 text-sm"
          style={{
            backgroundColor: "var(--c-orange-tint)",
            border: "1px solid var(--c-line)",
            color: "var(--c-ink-2)",
          }}
        >
          <h3 className="text-base font-semibold" style={{ color: "var(--c-ink)" }}>Automated health checks</h3>
          <p>
            Supabase Edge Functions poll provider tokens nightly. Expiring connections trigger email alerts via Resend and appear on the Planner status feed.
          </p>
        </section>

        {featureFlags.connectionDiagnostics ? (
          <Suspense fallback={null}>
            <ConnectionDiagnostics />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
