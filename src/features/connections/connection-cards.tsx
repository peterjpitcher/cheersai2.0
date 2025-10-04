import Link from "next/link";

import { ConnectionMetadataForm } from "@/features/connections/connection-metadata-form";
import { ConnectionOAuthButton } from "@/features/connections/connection-oauth-button";
import { listConnectionSummaries } from "@/lib/connections/data";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  expiring: "bg-amber-100 text-amber-700",
  needs_action: "bg-rose-100 text-rose-700",
};

const PROVIDER_LABELS = {
  facebook: "Facebook Page",
  instagram: "Instagram Business",
  gbp: "Google Business Profile",
} as const;

const PROVIDER_DOC_LINKS = {
  facebook: "https://developers.facebook.com/docs/pages/publishing/",
  instagram: "https://developers.facebook.com/docs/instagram-api/guides/content-publishing/",
  gbp: "https://developers.google.com/my-business/content/posts-data",
} as const;

const METADATA_FIELDS = {
  facebook: {
    label: "Facebook Page ID",
    helper: "Find this in the Page settings → About section; used for Graph API publishing.",
    placeholder: "1234567890",
    key: "pageId",
  },
  instagram: {
    label: "Instagram Business Account ID",
    helper: "Required for Instagram Graph publishing. Retrieve via Facebook Business Manager.",
    placeholder: "178414...",
    key: "igBusinessId",
  },
  gbp: {
    label: "Google Location ID",
    helper: "The `locations/{id}` identifier from Google Business Profile API.",
    placeholder: "locations/12345678901234567890",
    key: "locationId",
  },
} as const;

export async function ConnectionCards() {
  const connections = await listConnectionSummaries();

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {connections.map((connection) => {
        const statusStyle = STATUS_STYLES[connection.status];
        const providerLabel = PROVIDER_LABELS[connection.provider];
        const metadataConfig = METADATA_FIELDS[connection.provider];
        const metadataRecord = (connection.metadata ?? {}) as Record<string, unknown>;
        const metadataValue =
          typeof metadataRecord[metadataConfig.key] === "string"
            ? (metadataRecord[metadataConfig.key] as string)
            : "";
        const metadataMissing = !connection.metadataValid;
        const helperText = metadataMissing
          ? `Required: ${metadataConfig.helper}`
          : metadataConfig.helper;

        return (
          <article
            key={connection.provider}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusStyle}`}>
              {connection.status.replace("_", " ")}
            </span>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">{providerLabel}</h3>
            <p className="text-sm text-slate-600">{connection.displayName}</p>
            {metadataMissing ? (
              <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                Metadata required — add your {metadataConfig.label.toLowerCase()} below to enable automatic publishing.
              </p>
            ) : null}
            <dl className="mt-4 space-y-2 text-xs text-slate-500">
              {connection.lastSyncedAt ? (
                <div className="flex justify-between">
                  <dt>Last published</dt>
                  <dd>{new Date(connection.lastSyncedAt).toLocaleString()}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt>Token expiry</dt>
                <dd>
                  {connection.expiresAt
                    ? new Date(connection.expiresAt).toLocaleDateString()
                    : "Reconnect required"}
                </dd>
              </div>
            </dl>
            <div className="mt-6">
              <ConnectionMetadataForm
                provider={connection.provider}
                label={metadataConfig.label}
                helper={helperText}
                placeholder={metadataConfig.placeholder}
                defaultValue={metadataValue}
                invalid={metadataMissing}
              />
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <ConnectionOAuthButton provider={connection.provider} status={connection.status} />
              <Link
                href={PROVIDER_DOC_LINKS[connection.provider]}
                target="_blank"
                className="text-xs font-medium text-slate-500 underline"
              >
                Provider limits & docs
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
