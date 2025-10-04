export type ProviderPlatform = "facebook" | "instagram" | "gbp";

export interface ConnectionMetadataResolution {
  ok: true;
  metadata: Record<string, unknown>;
}

export interface ConnectionMetadataError {
  ok: false;
  error: string;
}

interface SourceMetadata {
  pageId?: unknown;
  igBusinessId?: unknown;
  igUserId?: unknown;
  locationId?: unknown;
}

export function resolveConnectionMetadata(
  provider: ProviderPlatform,
  metadata: Record<string, unknown> | null,
): ConnectionMetadataResolution | ConnectionMetadataError {
  const raw = (metadata ?? {}) as SourceMetadata;
  const result: Record<string, unknown> = {};

  const ensureString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  switch (provider) {
    case "facebook": {
      const pageId = ensureString(raw.pageId);
      if (!pageId) {
        return { ok: false, error: "Facebook connection missing pageId metadata." };
      }
      result.pageId = pageId;
      break;
    }
    case "instagram": {
      const igBusinessId = ensureString(raw.igBusinessId ?? raw.igUserId);
      if (!igBusinessId) {
        return { ok: false, error: "Instagram connection missing igBusinessId metadata." };
      }
      result.igBusinessId = igBusinessId;
      break;
    }
    case "gbp": {
      const locationId = ensureString(raw.locationId);
      if (!locationId) {
        return { ok: false, error: "Google Business connection missing locationId metadata." };
      }
      result.locationId = locationId;
      break;
    }
    default:
      return { ok: true, metadata: {} };
  }

  return { ok: true, metadata: result };
}
