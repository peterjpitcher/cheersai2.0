import { Suspense } from "react";

import { featureFlags } from "@/env";
import { ConnectionCards } from "@/features/connections/connection-cards";
import { ConnectionDiagnostics } from "@/features/connections/connection-diagnostics";
import { ConnectionOAuthHandler } from "@/features/connections/connection-oauth-handler";

export default function ConnectionsPage() {
  return (
    <div className="space-y-8">
      <header className="rounded-2xl bg-brand-sandstone px-6 py-5 text-white shadow-md">
        <h2 className="text-3xl font-semibold">Connections</h2>
        <p className="mt-2 text-sm text-white/80">
          Keep tokens healthy, understand provider limits, and react quickly to expiring access.
        </p>
        <Suspense fallback={null}>
          <ConnectionOAuthHandler />
        </Suspense>
      </header>
      <ConnectionCards />
      <section className="rounded-2xl border border-brand-sandstone/50 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-brand-sandstone">Automated health checks</h3>
        <p className="mt-2 text-sm text-brand-sandstone/80">
          Supabase Edge Functions poll provider tokens nightly. Expiring connections trigger email alerts via Resend and appear on the Planner status feed.
        </p>
      </section>
      {featureFlags.connectionDiagnostics ? (
        <Suspense fallback={null}>
          <ConnectionDiagnostics />
        </Suspense>
      ) : null}
    </div>
  );
}
