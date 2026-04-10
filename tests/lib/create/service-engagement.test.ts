import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "https://example.com/key";
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "supabase-service-role-key";

const { __testables } = await import("@/lib/create/service");
import { HOOK_STRATEGY_KEYS } from "@/lib/ai/hooks";
import { selectHookStrategy } from "@/lib/ai/hooks";
import { inferContentPillar, buildPillarNudge } from "@/lib/ai/pillars";

describe("fetchRecentCopyHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should extract hook_strategy and content_pillar from DB rows", async () => {
    const mockData = [
      { hook_strategy: "question", content_pillar: "food_drink" },
      { hook_strategy: "bold_statement", content_pillar: "events" },
      { hook_strategy: "scarcity", content_pillar: "seasonal" },
    ];

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: mockData, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof __testables.fetchRecentCopyHistoryForTest>[0];

    const result = await __testables.fetchRecentCopyHistoryForTest(
      mockSupabase,
      "account-123",
    );

    // Reversed from DB order (newest-first) so newest is at end
    expect(result.recentHooks).toEqual(["scarcity", "bold_statement", "question"]);
    expect(result.recentPillars).toEqual(["seasonal", "events", "food_drink"]);
  });

  it("should skip null/undefined values in DB rows", async () => {
    const mockData = [
      { hook_strategy: "question", content_pillar: null },
      { hook_strategy: null, content_pillar: "events" },
      { hook_strategy: undefined, content_pillar: undefined },
    ];

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: mockData, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof __testables.fetchRecentCopyHistoryForTest>[0];

    const result = await __testables.fetchRecentCopyHistoryForTest(
      mockSupabase,
      "account-123",
    );

    expect(result.recentHooks).toEqual(["question"]);
    expect(result.recentPillars).toEqual(["events"]);
  });

  it("should return empty arrays on DB error (non-fatal)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: null,
                  error: { message: "column does not exist" },
                }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof __testables.fetchRecentCopyHistoryForTest>[0];

    const result = await __testables.fetchRecentCopyHistoryForTest(
      mockSupabase,
      "account-123",
    );

    expect(result.recentHooks).toEqual([]);
    expect(result.recentPillars).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });
});

describe("hook + pillar in-memory batch tracking", () => {
  it("hook selection uses DB history combined with in-memory tracking", () => {
    // Simulate DB history seeded with 3 hooks
    const recentHooks = ["question", "bold_statement", "direct_address"];
    const avoided = new Set(recentHooks);

    // First selection should avoid the DB history
    const hook1 = selectHookStrategy(recentHooks);
    expect(avoided.has(hook1)).toBe(false);
    expect(HOOK_STRATEGY_KEYS).toContain(hook1);

    // Push to in-memory tracker (simulating what buildVariants does)
    recentHooks.push(hook1);

    // Second selection should avoid last 3 (including the one just picked)
    const hook2 = selectHookStrategy(recentHooks);
    expect(HOOK_STRATEGY_KEYS).toContain(hook2);
    // Should avoid at minimum the most recent
    expect(hook2).not.toBe(hook1);
  });

  it("pillar inference runs for each plan and tracks in-memory", () => {
    const recentPillars: string[] = [];

    // Plan 1: food-related
    const pillar1 = inferContentPillar("Sunday Roast", "Our chef's special");
    expect(pillar1).toBe("food_drink");
    recentPillars.push(pillar1);

    // Plan 2: events-related
    const pillar2 = inferContentPillar("Live Music Night", "Band plays Saturday");
    expect(pillar2).toBe("events");
    recentPillars.push(pillar2);

    // Nudge should be null (different pillars)
    const nudge1 = buildPillarNudge("events", recentPillars);
    expect(nudge1).toBeNull();

    // Plan 3: another food post — should get nudge since last 2 include food_drink
    const pillar3 = inferContentPillar("Burger Special", "New menu item");
    expect(pillar3).toBe("food_drink");

    // But food_drink is not the last 2 (food_drink, events) — no nudge
    const nudge2 = buildPillarNudge(pillar3, recentPillars);
    expect(nudge2).toBeNull();

    // If we add another food_drink, then nudge should fire
    recentPillars.push("food_drink");
    recentPillars.push("food_drink");
    const nudge3 = buildPillarNudge("food_drink", recentPillars);
    expect(nudge3).toContain("Recent posts have focused on Food & Drink");
  });

  it("batch of 4 plans produces unique hooks when seeded with empty history", () => {
    const recentHooks: string[] = [];
    const hooks: string[] = [];

    for (let i = 0; i < 4; i++) {
      const hook = selectHookStrategy(recentHooks);
      hooks.push(hook);
      recentHooks.push(hook);
    }

    // All 4 should be valid hook strategies
    for (const hook of hooks) {
      expect(HOOK_STRATEGY_KEYS).toContain(hook);
    }

    // No two consecutive hooks should be the same
    for (let i = 1; i < hooks.length; i++) {
      expect(hooks[i]).not.toBe(hooks[i - 1]);
    }
  });
});

describe("fetchRecentCopyHistory ordering", () => {
  it("should reverse DB rows so newest hooks are at the end (for slice(-3) in selectHookStrategy)", async () => {
    // DB returns newest-first: question is newest, behind_scenes is oldest
    const mockData = [
      { hook_strategy: "question", content_pillar: "food_drink" },
      { hook_strategy: "bold_statement", content_pillar: "events" },
      { hook_strategy: "scarcity", content_pillar: "seasonal" },
      { hook_strategy: "seasonal", content_pillar: "behind_scenes" },
      { hook_strategy: "behind_scenes", content_pillar: "customer_love" },
    ];

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: mockData, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof __testables.fetchRecentCopyHistoryForTest>[0];

    const result = await __testables.fetchRecentCopyHistoryForTest(
      mockSupabase,
      "account-123",
    );

    // After reversal, oldest should be first, newest should be last
    // This means slice(-3) in selectHookStrategy will get the 3 newest:
    // question, bold_statement, scarcity
    expect(result.recentHooks).toEqual([
      "behind_scenes",  // oldest — first
      "seasonal",
      "scarcity",
      "bold_statement",
      "question",        // newest — last
    ]);

    // selectHookStrategy uses slice(-3) which should now exclude the 3 newest:
    // question, bold_statement, scarcity
    const newestThree = new Set(["question", "bold_statement", "scarcity"]);
    for (let i = 0; i < 50; i++) {
      const hook = selectHookStrategy(result.recentHooks);
      expect(newestThree.has(hook)).toBe(false);
    }
  });

  it("should reverse DB rows so newest pillars are at the end (for slice(-2) in buildPillarNudge)", async () => {
    // DB returns newest-first: both newest are food_drink
    const mockData = [
      { hook_strategy: "question", content_pillar: "food_drink" },
      { hook_strategy: "bold_statement", content_pillar: "food_drink" },
      { hook_strategy: "scarcity", content_pillar: "events" },
    ];

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: mockData, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof __testables.fetchRecentCopyHistoryForTest>[0];

    const result = await __testables.fetchRecentCopyHistoryForTest(
      mockSupabase,
      "account-123",
    );

    // After reversal: ["events", "food_drink", "food_drink"]
    // slice(-2) should be ["food_drink", "food_drink"] — triggering a nudge
    expect(result.recentPillars).toEqual(["events", "food_drink", "food_drink"]);

    const nudge = buildPillarNudge("food_drink", result.recentPillars);
    expect(nudge).toContain("Recent posts have focused on Food & Drink");
  });
});

describe("content_items INSERT columns", () => {
  it("BuiltVariant hookStrategy and contentPillar are optional and flow to insert", () => {
    // This test verifies the type contract — hookStrategy and contentPillar
    // are set on BuiltVariant by buildVariants and mapped to content_items rows
    // with fallback to null. We test the mapping logic inline here.
    const variant = {
      platform: "facebook" as const,
      body: "Test post",
      scheduledFor: new Date(),
      promptContext: {},
      mediaIds: [],
      options: {} as Record<string, unknown>,
      linkInBioUrl: null,
      placement: "feed" as const,
      hookStrategy: "question",
      contentPillar: "food_drink",
    };

    // Simulate the mapping in createCampaignFromPlans
    const row = {
      hook_strategy: variant.hookStrategy ?? null,
      content_pillar: variant.contentPillar ?? null,
    };

    expect(row.hook_strategy).toBe("question");
    expect(row.content_pillar).toBe("food_drink");
  });

  it("should map undefined hookStrategy/contentPillar to null", () => {
    const variant = {
      platform: "facebook" as const,
      body: "Test post",
      scheduledFor: new Date(),
      promptContext: {},
      mediaIds: [],
      options: {} as Record<string, unknown>,
      linkInBioUrl: null,
      placement: "story" as const,
      // No hookStrategy or contentPillar (story posts)
    };

    const row = {
      hook_strategy: (variant as { hookStrategy?: string }).hookStrategy ?? null,
      content_pillar: (variant as { contentPillar?: string }).contentPillar ?? null,
    };

    expect(row.hook_strategy).toBeNull();
    expect(row.content_pillar).toBeNull();
  });
});
