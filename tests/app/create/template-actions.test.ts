import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any imports that trigger
// module evaluation.
// ---------------------------------------------------------------------------

const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

// We mock requireAuthContext so it returns a controllable fake supabase
// client and a fixed accountId without touching cookies, redirects, or DB.
const requireAuthContextMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuthContext: (...args: unknown[]) => requireAuthContextMock(...args),
}));

// ---------------------------------------------------------------------------
// Supabase mock builder
// ---------------------------------------------------------------------------

// Individual terminal operation mocks — reassigned per test via mockResolvedValueOnce.
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockDelete = vi.fn();

// A chainable query builder. Every method returns `mockQueryBuilder` itself so
// callers can chain .from().select().eq().order() etc.
const mockQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: mockDelete,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
};

// Ensure delete itself is chainable so callers can do .delete().eq().eq()
mockDelete.mockReturnValue(mockQueryBuilder);

const mockSupabase = {
  from: vi.fn().mockReturnValue(mockQueryBuilder),
};

const ACCOUNT_ID = "account-abc-123";
const FAKE_AUTH = { supabase: mockSupabase, accountId: ACCOUNT_ID, user: { id: "user-1" } };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.from.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select.mockReturnThis();
    mockQueryBuilder.eq.mockReturnThis();
    mockQueryBuilder.order.mockReturnThis();
    mockDelete.mockReturnValue(mockQueryBuilder);
    requireAuthContextMock.mockResolvedValue(FAKE_AUTH);
  });

  it("returns a mapped camelCase array when Supabase returns rows", async () => {
    const rows = [
      {
        id: "t1",
        name: "My Template",
        prompt: "Write a Sunday roast post.",
        platforms: ["facebook"],
        tone_adjust: "default",
        cta_url: "https://example.com",
        notes: "Some notes",
        use_count: 3,
        created_at: "2026-01-01T10:00:00Z",
      },
    ];

    // listTemplates ends the chain with implicit data/error resolution
    // The Supabase client returns { data, error } from the awaited query.
    // Since mockQueryBuilder.order returns `mockQueryBuilder` (which is awaited),
    // we need to make the query builder itself resolve to { data, error }.
    mockQueryBuilder.order.mockResolvedValueOnce({ data: rows, error: null });

    const { listTemplates } = await import("@/app/(app)/create/template-actions");
    const result = await listTemplates();

    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item?.id).toBe("t1");
    expect(item?.name).toBe("My Template");
    expect(item?.toneAdjust).toBe("default");
    expect(item?.ctaUrl).toBe("https://example.com");
    expect(item?.useCount).toBe(3);
    expect(item?.createdAt).toBe("2026-01-01T10:00:00Z");
  });

  it("returns an empty array when Supabase returns no rows", async () => {
    mockQueryBuilder.order.mockResolvedValueOnce({ data: [], error: null });

    const { listTemplates } = await import("@/app/(app)/create/template-actions");
    const result = await listTemplates();

    expect(result).toEqual([]);
  });

  it("throws when Supabase returns an error", async () => {
    mockQueryBuilder.order.mockResolvedValueOnce({
      data: null,
      error: { message: "DB connection failed" },
    });

    const { listTemplates } = await import("@/app/(app)/create/template-actions");

    await expect(listTemplates()).rejects.toThrow(/Failed to load templates/);
  });
});

describe("saveTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.from.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select.mockReturnThis();
    mockQueryBuilder.eq.mockReturnThis();
    mockQueryBuilder.order.mockReturnThis();
    mockQueryBuilder.insert.mockReturnThis();
    mockDelete.mockReturnValue(mockQueryBuilder);
    requireAuthContextMock.mockResolvedValue(FAKE_AUTH);
  });

  it("inserts correct data and returns { success: true, id } on success", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "new-template-id" }, error: null });

    const { saveTemplate } = await import("@/app/(app)/create/template-actions");
    const result = await saveTemplate({
      name: "Quiz Night",
      prompt: "Write a quiz night announcement for Thursday.",
      platforms: ["facebook", "instagram"],
      toneAdjust: "more_playful",
      ctaUrl: "https://example.com/quiz",
      notes: "Fun and upbeat",
    });

    expect(result).toEqual({ success: true, id: "new-template-id" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/create");

    // Verify the insert call received the account_id
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: ACCOUNT_ID,
        name: "Quiz Night",
        tone_adjust: "more_playful",
      }),
    );
  });

  it("returns { error } when Supabase insert fails", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "unique constraint violation" },
    });

    const { saveTemplate } = await import("@/app/(app)/create/template-actions");
    const result = await saveTemplate({
      name: "Quiz Night",
      prompt: "Write a quiz night announcement for Thursday.",
      platforms: ["facebook"],
      toneAdjust: "default",
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/Failed to save template/);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns { error } when input validation fails", async () => {
    const { saveTemplate } = await import("@/app/(app)/create/template-actions");

    // name is required and must be non-empty
    const result = await saveTemplate({
      name: "",
      prompt: "Some prompt",
      platforms: ["facebook"],
      toneAdjust: "default",
    });

    expect(result).toHaveProperty("error");
    expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
  });
});

describe("deleteTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.from.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select.mockReturnThis();
    mockQueryBuilder.eq.mockReturnThis();
    mockDelete.mockReturnValue(mockQueryBuilder);
    requireAuthContextMock.mockResolvedValue(FAKE_AUTH);
  });

  it("calls delete with the correct id and account scoping, returns { success: true }", async () => {
    // The delete chain ends at the second .eq() call; it resolves to { error: null }
    // We make .eq() resolve on the second call to simulate the end of the chain.
    mockQueryBuilder.eq
      .mockReturnValueOnce(mockQueryBuilder) // first .eq("id", id)
      .mockResolvedValueOnce({ error: null }); // second .eq("account_id", accountId) — awaited

    const { deleteTemplate } = await import("@/app/(app)/create/template-actions");
    const result = await deleteTemplate("template-xyz");

    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/create");
    expect(mockDelete).toHaveBeenCalled();
  });

  it("returns { error } when Supabase delete fails", async () => {
    mockQueryBuilder.eq
      .mockReturnValueOnce(mockQueryBuilder)
      .mockResolvedValueOnce({ error: { message: "row not found" } });

    const { deleteTemplate } = await import("@/app/(app)/create/template-actions");
    const result = await deleteTemplate("template-xyz");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/Failed to delete template/);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns { error } for an invalid id without hitting the database", async () => {
    const { deleteTemplate } = await import("@/app/(app)/create/template-actions");

    const result = await deleteTemplate("");

    expect(result).toEqual({ error: "Invalid template ID" });
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
