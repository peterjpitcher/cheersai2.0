import { Suspense } from "react";

import { featureFlags } from "@/env";
import { ConnectionCards } from "@/features/connections/connection-cards";
import { ConnectionDiagnostics } from "@/features/connections/connection-diagnostics";
import { ConnectionOAuthHandler } from "@/features/connections/connection-oauth-handler";
import { PageHeader } from "@/components/layout/PageHeader";

export default function ConnectionsPage() {
  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title="Connections"
        description="Keep tokens healthy, understand provider limits, and react quickly to expiring access."
      />

      <div className="rounded-xl border border-white/20 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm shadow-sm p-4 md:p-6 space-y-8">
        <Suspense fallback={null}>
          <ConnectionOAuthHandler />
        </Suspense>

        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">Connected accounts</h3>
            <p className="text-sm text-muted-foreground">Status, tokens, and reconnect controls for each provider.</p>
          </div>
          <ConnectionCards />
        </section>

        <section className="space-y-2 rounded-lg border border-white/30 bg-white/70 p-4 text-sm text-muted-foreground shadow-sm backdrop-blur-sm dark:bg-slate-900/60">
          <h3 className="text-base font-semibold text-foreground">Automated health checks</h3>
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
