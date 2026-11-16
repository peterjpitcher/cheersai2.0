/**
 * Connection-side providers. Google ("gbp") is a connection only: it is not in
 * the content `Platform` type, so nothing outside Connections sees it yet.
 */
export type ConnectionProvider = "facebook" | "instagram" | "gbp";

export interface ConnectionMetadataResult {
  complete: boolean;
  missingKeys: string[];
}

const REQUIRED_KEYS: Record<ConnectionProvider, Array<{ key: string; label: string }>> = {
  facebook: [{ key: "pageId", label: "Facebook Page ID" }],
  instagram: [{ key: "igBusinessId", label: "Instagram Business Account ID" }],
  gbp: [{ key: "localPostParent", label: "Google location" }],
};

export function evaluateConnectionMetadata(
  provider: ConnectionProvider,
  metadata: Record<string, unknown> | null | undefined,
): ConnectionMetadataResult {
  const requirements = REQUIRED_KEYS[provider];
  if (!requirements) {
    return { complete: true, missingKeys: [] };
  }

  const missingKeys = requirements
    .filter((requirement) => {
      const value = metadata?.[requirement.key];
      const asString = typeof value === "string" ? value.trim() : "";
      return !asString;
    })
    .map((requirement) => requirement.key);

  if (missingKeys.length) {
    return { complete: false, missingKeys };
  }

  return { complete: true, missingKeys: [] };
}

export function getRequiredMetadataKey(provider: ConnectionProvider) {
  return REQUIRED_KEYS[provider]?.[0]?.key;
}
