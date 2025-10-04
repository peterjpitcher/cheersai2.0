import { Suspense } from "react";

import { featureFlags } from "@/env";
import { ConnectionCards } from "@/features/connections/connection-cards";
import { ConnectionDiagnostics } from "@/features/connections/connection-diagnostics";
import { ConnectionOAuthHandler } from "@/features/connections/connection-oauth-handler";

export default function ConnectionsPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold text-slate-900">Connections</h2>
        <p className="text-slate-600">
          Keep tokens healthy, understand provider limits, and react quickly to expiring access.
        </p>
        <Suspense fallback={null}>
          <ConnectionOAuthHandler />
        </Suspense>
      </header>
      <ConnectionCards />
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Automated health checks</h3>
        <p className="mt-2 text-sm text-slate-500">
          Supabase Edge Functions poll provider tokens nightly. Expiring connections trigger email alerts via
          Resend and appear on the Planner status feed.
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
