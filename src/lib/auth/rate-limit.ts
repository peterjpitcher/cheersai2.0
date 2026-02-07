import "server-only";
import crypto from "node:crypto";

import { isSchemaMissingError } from "@/lib/supabase/errors";
import { tryCreateServiceSupabaseClient } from "@/lib/supabase/service";

const fallbackStore = new Map<string, { count: number; resetAt: number }>();

function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function extractIp(request: Request) {
  const candidates = [
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-vercel-forwarded-for"),
    request.headers.get("x-client-ip"),
  ];

  for (const entry of candidates) {
    if (!entry) continue;
    const [first] = entry.split(",");
    const trimmed = first?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function getFallbackKey(request: Request) {
  const userAgent = request.headers.get("user-agent") ?? "";
  if (userAgent.trim()) {
    return `ua:${hashValue(userAgent)}`;
  }
  return "unknown";
}

export function getRateLimitKey(request: Request, prefix: string) {
  const ip = extractIp(request);
  const base = ip ? `ip:${ip}` : getFallbackKey(request);
  return `${prefix}:${base}`;
}

function isRateLimitedInMemory(key: string, maxAttempts: number, windowMs: number) {
  const now = Date.now();
  const record = fallbackStore.get(key);
  if (!record || record.resetAt < now) {
    fallbackStore.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  record.count += 1;
  fallbackStore.set(key, record);
  return record.count > maxAttempts;
}

export async function isRateLimited(params: {
  key: string;
  maxAttempts: number;
  windowMs: number;
}): Promise<boolean> {
  const { key, maxAttempts, windowMs } = params;
  const service = tryCreateServiceSupabaseClient();
  if (!service) {
    return isRateLimitedInMemory(key, maxAttempts, windowMs);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  try {
    const { data, error } = await service
      .from("auth_rate_limits")
      .select("count, reset_at")
      .eq("key", key)
      .maybeSingle<{ count: number | null; reset_at: string | null }>();

    if (error) {
      if (isSchemaMissingError(error)) {
        return isRateLimitedInMemory(key, maxAttempts, windowMs);
      }
      throw error;
    }

    if (!data?.reset_at || new Date(data.reset_at).getTime() <= now) {
      await service
        .from("auth_rate_limits")
        .upsert(
          {
            key,
            count: 1,
            reset_at: new Date(now + windowMs).toISOString(),
            updated_at: nowIso,
          },
          { onConflict: "key" },
        );
      return false;
    }

    const nextCount = (data.count ?? 0) + 1;
    await service
      .from("auth_rate_limits")
      .update({ count: nextCount, updated_at: nowIso })
      .eq("key", key);

    return nextCount > maxAttempts;
  } catch (error) {
    console.warn("[auth] rate limit fallback", error);
    return isRateLimitedInMemory(key, maxAttempts, windowMs);
  }
}
