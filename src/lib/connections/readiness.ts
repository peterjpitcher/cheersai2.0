export type ConnectionProvider = "facebook" | "instagram" | "gbp";

export type ConnectionStatus = "active" | "expiring" | "needs_action";

export type ConnectionIssueSeverity = "error" | "warning";

export interface ConnectionReadinessIssue {
  code:
    | "connection_missing"
    | "connection_status"
    | "token_missing"
    | "token_expired"
    | "token_expiring"
    | "token_expiry_unknown"
    | "metadata_missing";
  severity: ConnectionIssueSeverity;
  message: string;
}

export interface ConnectionReadinessInput {
  provider: ConnectionProvider;
  storedStatus: string | null | undefined;
  metadataComplete: boolean;
  hasAccessToken: boolean;
  expiresAt: string | null | undefined;
  connected?: boolean;
  now?: number;
}

export interface ConnectionReadiness {
  status: ConnectionStatus;
  ready: boolean;
  issues: ConnectionReadinessIssue[];
}

const EXPIRY_WARNING_DAYS = 7;
const EXPIRY_WARNING_MS = EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
// Instagram publishing with Facebook Login stores a Facebook Page access token.
// Null expiry means Meta did not return an expiry, not that the connection is unhealthy.
const NEVER_EXPIRING_PROVIDERS: ConnectionProvider[] = ["facebook", "instagram"];

const PROVIDER_LABELS: Record<ConnectionProvider, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

export function hasTokenValue(token: string | null | undefined): boolean {
  return typeof token === "string" && token.trim().length > 0;
}

export function deriveConnectionReadiness({
  provider,
  storedStatus,
  metadataComplete,
  hasAccessToken,
  expiresAt,
  connected = true,
  now = Date.now(),
}: ConnectionReadinessInput): ConnectionReadiness {
  const issues: ConnectionReadinessIssue[] = [];

  if (!connected) {
    issues.push({
      code: "connection_missing",
      severity: "error",
      message: `Connect ${PROVIDER_LABELS[provider]} before publishing.`,
    });
  }

  const normalizedStoredStatus = normalizeStoredStatus(storedStatus);
  if (connected && normalizedStoredStatus !== "active" && normalizedStoredStatus !== "expiring") {
    issues.push({
      code: "connection_status",
      severity: "error",
      message: `${PROVIDER_LABELS[provider]} needs to be reconnected.`,
    });
  }

  if (connected && !hasAccessToken) {
    issues.push({
      code: "token_missing",
      severity: "error",
      message: `${PROVIDER_LABELS[provider]} access token is missing.`,
    });
  }

  if (connected && !metadataComplete) {
    issues.push({
      code: "metadata_missing",
      severity: "error",
      message: `${PROVIDER_LABELS[provider]} is missing required publishing metadata.`,
    });
  }

  if (connected && expiresAt) {
    const expiry = new Date(expiresAt);
    if (!Number.isNaN(expiry.getTime())) {
      const timeUntilExpiry = expiry.getTime() - now;

      if (timeUntilExpiry <= 0) {
        issues.push({
          code: "token_expired",
          severity: "error",
          message: `${PROVIDER_LABELS[provider]} access token has expired.`,
        });
      } else if (timeUntilExpiry <= EXPIRY_WARNING_MS) {
        issues.push({
          code: "token_expiring",
          severity: "warning",
          message: `${PROVIDER_LABELS[provider]} access token expires within ${EXPIRY_WARNING_DAYS} days.`,
        });
      }
    }
  } else if (connected && hasAccessToken && !NEVER_EXPIRING_PROVIDERS.includes(provider)) {
    issues.push({
      code: "token_expiry_unknown",
      severity: "warning",
      message: `${PROVIDER_LABELS[provider]} token expiry is unknown.`,
    });
  }

  const ready = issues.every((issue) => issue.severity !== "error");
  const status = !ready
    ? "needs_action"
    : issues.some((issue) => issue.severity === "warning")
      ? "expiring"
      : "active";

  return { status, ready, issues };
}

function normalizeStoredStatus(status: string | null | undefined) {
  if (status === "active" || status === "expiring") {
    return status;
  }
  return "needs_action";
}
