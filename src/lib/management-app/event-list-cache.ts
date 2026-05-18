import { createHash } from "crypto";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;

const cache = new Map<string, CacheEntry<unknown>>();

export function buildEventListCacheKey(parts: {
  accountId: string;
  baseUrl: string;
  apiKey: string;
  limit: number;
  query: string | undefined;
}): string {
  const keyFingerprint = createHash("sha256")
    .update(parts.apiKey)
    .digest("hex")
    .slice(0, 8);

  return [
    parts.accountId,
    parts.baseUrl,
    String(parts.limit),
    parts.query ?? "",
    keyFingerprint,
  ].join("|");
}

export async function getCachedEventList<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    return existing.data as T;
  }

  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export function clearEventListCache(): void {
  cache.clear();
}
