import { ConnectionDisconnectButton } from "@/features/connections/connection-disconnect-button";
import { ConnectionOAuthButton } from "@/features/connections/connection-oauth-button";
import { getGoogleConnectionSummary } from "@/lib/connections/google-data";
import { GOOGLE_CONNECT_MESSAGES } from "@/lib/connections/google-messages";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  expiring: "bg-amber-100 text-amber-700",
  needs_action: "bg-rose-100 text-rose-700",
};

const ISSUE_STYLES = {
  error: "border-rose-200 bg-rose-50 text-rose-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
} as const;

interface GoogleConnectionCardProps {
  /** Owners only (decision D4); the server actions enforce it too. */
  canManage: boolean;
}

/**
 * The Google card on the Connections page. Renders nothing for a brand
 * without Google posting switched on: the summary is null for it, whatever
 * is stored. Connecting only links a location; nothing is posted to Google yet.
 */
export async function GoogleConnectionCard({ canManage }: GoogleConnectionCardProps) {
  const summary = await getGoogleConnectionSummary();
  if (!summary) {
    return null;
  }

  // A connection that was never made is not an error to shout about.
  const issues = summary.connected ? summary.issues : [];

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <span
        className={`inline-block rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[summary.status]}`}
      >
        {summary.connected ? summary.status.replace("_", " ") : "Not connected"}
      </span>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">Google</h3>
      <p className="text-sm text-slate-600">{summary.locationTitle ?? "Your Google business profile"}</p>

      {!summary.configured ? (
        <p className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${ISSUE_STYLES.warning}`}>
          {GOOGLE_CONNECT_MESSAGES.notSetUp}
        </p>
      ) : null}

      {issues.length ? (
        <div className="mt-3 space-y-2">
          {issues.map((issue) => (
            <p key={issue.code} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${ISSUE_STYLES[issue.severity]}`}>
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <dl className="mt-4 space-y-2 text-xs text-slate-500">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <dt>Connection</dt>
          <dd className="text-right">{summary.ready ? "Ready" : summary.connected ? "Action needed" : "Not connected"}</dd>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <dt>Access</dt>
          <dd className="text-right">
            {summary.hasRefreshToken ? (
              <span className="text-emerald-600">Renews automatically</span>
            ) : (
              "Not stored"
            )}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-slate-500">
        Connecting links one location. To use a different location, connect again and choose it.
      </p>

      {canManage ? (
        <div className="mt-6 flex flex-col gap-2">
          {summary.configured ? (
            <ConnectionOAuthButton
              provider="gbp"
              status={summary.status}
              hasAccessToken={summary.hasAccessToken || summary.hasRefreshToken}
            />
          ) : null}
          {summary.hasAccessToken || summary.hasRefreshToken ? <ConnectionDisconnectButton provider="gbp" /> : null}
        </div>
      ) : null}
    </article>
  );
}
