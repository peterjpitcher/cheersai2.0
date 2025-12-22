import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const isSchemaMissingErrorMock = vi.fn();
const returnsMock = vi.fn();
const createSignedUrlsMock = vi.fn();

const queryBuilder: Record<string, unknown> = {};

Object.assign(queryBuilder, {
  select: vi.fn(() => queryBuilder),
  eq: vi.fn(() => queryBuilder),
  order: vi.fn(() => queryBuilder),
  limit: vi.fn(() => queryBuilder),
  returns: (...args: unknown[]) => returnsMock(...args),
  is: vi.fn(() => queryBuilder),
});

const fromMock = vi.fn(() => queryBuilder);
const storageFromMock = vi.fn(() => ({ createSignedUrls: createSignedUrlsMock }));

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock("@/lib/supabase/errors", () => ({
  isSchemaMissingError: (...args: unknown[]) => isSchemaMissingErrorMock(...args),
}));

describe("listMediaAssets", () => {
  beforeAll(() => {
    const defaults: Record<string, string> = {
      ALERTS_SECRET: "test-alert",
      CRON_SECRET: "test-cron",
      FACEBOOK_APP_SECRET: "fb-secret",
      GOOGLE_MY_BUSINESS_CLIENT_ID: "google-client",
      GOOGLE_MY_BUSINESS_CLIENT_SECRET: "google-secret",
      INSTAGRAM_APP_ID: "ig-app",
      INSTAGRAM_APP_SECRET: "ig-secret",
      INSTAGRAM_VERIFY_TOKEN: "verify",
      OPENAI_API_KEY: "openai",
      RESEND_API_KEY: "resend",
      RESEND_FROM: "notifications@test",
      SUPABASE_SERVICE_ROLE_KEY: "supabase",
      NEXT_PUBLIC_FACEBOOK_APP_ID: "fb-app",
      NEXT_PUBLIC_SITE_URL: "https://example.com",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.local",
    };

    Object.entries(defaults).forEach(([key, value]) => {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    });
  });

  beforeEach(() => {
    requireAuthContextMock.mockReset();
    requireAuthContextMock.mockResolvedValue({
      accountId: "account-1",
      supabase: {
        from: fromMock,
        storage: { from: storageFromMock },
      },
    });
    isSchemaMissingErrorMock.mockReset();
    returnsMock.mockReset();
    createSignedUrlsMock.mockReset();
    createSignedUrlsMock.mockResolvedValue({ data: [], error: null });
    (queryBuilder.select as Mock).mockClear();
    (queryBuilder.eq as Mock).mockClear();
    (queryBuilder.order as Mock).mockClear();
    (queryBuilder.limit as Mock).mockClear();
    fromMock.mockClear();
    storageFromMock.mockClear();
  });

  it("exposes skipped derivatives with empty variant map", async () => {
    const uploadedAt = new Date("2025-02-01T12:00:00Z").toISOString();
    returnsMock.mockResolvedValue({
      data: [
        {
          id: "asset-1",
          file_name: "clip.mp4",
          media_type: "video",
          tags: ["promo"],
          uploaded_at: uploadedAt,
          size_bytes: 2048,
          storage_path: "media/asset-1.mp4",
          processed_status: "skipped",
          processed_at: uploadedAt,
          derived_variants: null,
        },
      ],
      error: null,
    });
    isSchemaMissingErrorMock.mockReturnValue(false);

    const { listMediaAssets } = await import("@/lib/library/data");
    const assets = await listMediaAssets();

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: "asset-1",
      fileName: "clip.mp4",
      mediaType: "video",
      processedStatus: "skipped",
      derivedVariants: {},
      previewUrl: undefined,
      previewShape: "square",
    });
    expect(requireAuthContextMock).toHaveBeenCalled();
  });

  it("returns empty list when schema missing", async () => {
    returnsMock.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    isSchemaMissingErrorMock.mockReturnValue(true);

    const { listMediaAssets } = await import("@/lib/library/data");
    const assets = await listMediaAssets();

    expect(assets).toEqual([]);
  });
});
