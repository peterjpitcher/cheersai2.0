import { featureFlags } from "@/env";
import { listConnectionDiagnostics } from "@/lib/connections/diagnostics";

function formatDate(value: string | null) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export async function ConnectionDiagnostics() {
  if (!featureFlags.connectionDiagnostics) {
    return null;
  }

  const diagnostics = await listConnectionDiagnostics();
  if (!diagnostics.length) {
    return null;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="space-y-1">
        <h3 className="text-lg font-semibold text-slate-900">Connection diagnostics</h3>
        <p className="text-sm text-slate-500">
          Inspect stored tokens, expiry, and metadata when troubleshooting publish failures. Secret values are
          truncated for safety.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Access token</th>
              <th className="px-3 py-2">Refresh token</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Last synced</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.map((item) => (
              <tr key={item.provider} className="rounded-xl bg-slate-50 text-sm text-slate-700">
                <td className="px-3 py-2 font-semibold capitalize">{item.provider}</td>
                <td className="px-3 py-2">
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium uppercase">
                    {item.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{item.accessTokenPreview ?? "–"}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{item.refreshTokenPreview ?? "–"}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{formatDate(item.expiresAt)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{formatDate(item.lastSyncedAt)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{formatDate(item.updatedAt)}</td>
                <td className="px-3 py-2 text-xs">
                  <pre className="max-h-32 overflow-auto rounded bg-white px-2 py-1 text-xs text-slate-600">
                    {JSON.stringify(item.metadata ?? {}, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
