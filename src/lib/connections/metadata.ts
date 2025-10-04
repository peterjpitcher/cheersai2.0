export type ConnectionProvider = "facebook" | "instagram" | "gbp";

export interface ConnectionMetadataResult {
  complete: boolean;
  missingKeys: string[];
}

const REQUIRED_KEYS: Record<ConnectionProvider, { key: string; label: string }> = {
  facebook: { key: "pageId", label: "Facebook Page ID" },
  instagram: { key: "igBusinessId", label: "Instagram Business Account ID" },
  gbp: { key: "locationId", label: "Google Business Location ID" },
};

export function evaluateConnectionMetadata(
  provider: ConnectionProvider,
  metadata: Record<string, unknown> | null | undefined,
): ConnectionMetadataResult {
  const requirement = REQUIRED_KEYS[provider];
  if (!requirement) {
    return { complete: true, missingKeys: [] };
  }

  const value = metadata?.[requirement.key];
  const asString = typeof value === "string" ? value.trim() : "";

  if (!asString) {
    return { complete: false, missingKeys: [requirement.key] };
  }

  return { complete: true, missingKeys: [] };
}

export function getRequiredMetadataKey(provider: ConnectionProvider) {
  return REQUIRED_KEYS[provider]?.key;
}
