import { Suspense } from "react";

import { featureFlags } from "@/env";
import { ConnectionCards } from "@/features/connections/connection-cards";
import { ConnectionDiagnostics } from "@/features/connections/connection-diagnostics";
import { ConnectionOAuthHandler } from "@/features/connections/connection-oauth-handler";

export default function ConnectionsPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/15 bg-brand-teal px-6 py-5 text-white shadow-lg">
        <h2 className="text-2xl font-semibold">Connections</h2>
        <p className="mt-2 text-sm text-white/80">
          Keep tokens healthy, understand provider limits, and react quickly to expiring access.
        </p>
        <Suspense fallback={null}>
          <ConnectionOAuthHandler />
        </Suspense>
      </section>
      <section className="space-y-6 rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <ConnectionCards />
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/90 p-6 text-brand-teal shadow-lg">
        <h3 className="text-lg font-semibold">Automated health checks</h3>
        <p className="mt-2 text-sm text-brand-teal/70">
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
