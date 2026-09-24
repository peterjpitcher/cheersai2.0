import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthContextMock = vi.fn();
const createServiceSupabaseClientMock = vi.fn();
const isSchemaMissingErrorMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: (...args: unknown[]) => requireAuthContextMock(...args),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: (...args: unknown[]) => createServiceSupabaseClientMock(...args),
}));

vi.mock("@/lib/supabase/errors", () => ({
  isSchemaMissingError: (...args: unknown[]) => isSchemaMissingErrorMock(...args),
}));

function createQueryBuilder() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(),
    upsert: vi.fn(() => builder),
    single: vi.fn(),
    update: vi.fn(() => builder),
  });
  return builder as {
    select: Mock;
    eq: Mock;
    maybeSingle: Mock;
    upsert: Mock;
    single: Mock;
    update: Mock;
  };
}

describe("management app connection data", () => {
  beforeEach(() => {
    vi.resetModules();
    requireAuthContextMock.mockReset();
    createServiceSupabaseClientMock.mockReset();
    isSchemaMissingErrorMock.mockReset();
    fromMock.mockReset();

    requireAuthContextMock.mockResolvedValue({
      features: { paidAds: true, tournaments: true, managementImport: true },
      accountId: "account-1",
    });
    createServiceSupabaseClientMock.mockReturnValue({
      from: fromMock,
    });
    isSchemaMissingErrorMock.mockImplementation((error: unknown) => {
      return typeof error === "object" && error !== null && (error as { code?: string }).code === "PGRST205";
    });
  });

  it("returns a default summary when the management connection table is missing", async () => {
    const builder = createQueryBuilder();
    builder.maybeSingle.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST205",
      },
    });
    fromMock.mockReturnValue(builder);

    const { getManagementConnectionSummary, DEFAULT_MANAGEMENT_APP_BASE_URL } = await import(
      "@/lib/management-app/data"
    );
    const summary = await getManagementConnectionSummary();

    expect(summary).toMatchObject({
      baseUrl: DEFAULT_MANAGEMENT_APP_BASE_URL,
      enabled: true,
      configured: false,
      hasApiKey: false,
    });
  });

  it("throws migration guidance when reading config and schema is missing", async () => {
    const builder = createQueryBuilder();
    builder.maybeSingle.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST205",
      },
    });
    fromMock.mockReturnValue(builder);

    const { getManagementConnectionConfig } = await import("@/lib/management-app/data");
    await expect(getManagementConnectionConfig()).rejects.toThrow("latest Supabase migrations");
  });

  it("throws migration guidance when saving and schema is missing", async () => {
    const builder = createQueryBuilder();
    builder.maybeSingle.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST205",
      },
    });
    fromMock.mockReturnValue(builder);

    const { saveManagementConnection } = await import("@/lib/management-app/data");
    await expect(
      saveManagementConnection({
        baseUrl: "https://management.example.com",
        apiKey: "anch_test",
        enabled: true,
      }),
    ).rejects.toThrow("latest Supabase migrations");
  });

  it("throws migration guidance when updating connection test status and schema is missing", async () => {
    const builder = createQueryBuilder();
    builder.maybeSingle.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST205",
      },
    });
    fromMock.mockReturnValue(builder);

    const { updateManagementConnectionTestResult } = await import("@/lib/management-app/data");
    await expect(
      updateManagementConnectionTestResult({
        status: "error",
        message: "failed",
      }),
    ).rejects.toThrow("latest Supabase migrations");
  });

  it("refuses to read or save the connection when the brand's import switch is off", async () => {
    requireAuthContextMock.mockResolvedValue({
      features: { paidAds: true, tournaments: true, managementImport: false },
      accountId: "account-1",
    });
    // Even with a stored, enabled connection row, nothing may be read.
    const builder = createQueryBuilder();
    builder.maybeSingle.mockResolvedValue({
      data: { base_url: "https://management.orangejelly.co.uk", api_key: "secret", enabled: true },
      error: null,
    });
    fromMock.mockReturnValue(builder);

    const { getManagementConnectionConfig, saveManagementConnection } = await import("@/lib/management-app/data");
    await expect(getManagementConnectionConfig()).rejects.toThrow("This brand doesn't have management app import switched on.");
    await expect(
      saveManagementConnection({ baseUrl: "https://management.orangejelly.co.uk", apiKey: "k", enabled: true }),
    ).rejects.toThrow("switched on");
    expect(fromMock).not.toHaveBeenCalled();
  });
});
