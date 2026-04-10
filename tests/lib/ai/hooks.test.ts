import { describe, it, expect } from "vitest";
import {
  selectHookStrategy,
  getHookInstruction,
  HOOK_STRATEGY_KEYS,
  HOOK_STRATEGIES,
  hookStrategySchema,
} from "@/lib/ai/hooks";

describe("selectHookStrategy", () => {
  it("should return a valid hook strategy", () => {
    const result = selectHookStrategy([]);
    expect(HOOK_STRATEGY_KEYS).toContain(result);
  });

  it("should avoid the last 3 hooks in recentHooks", () => {
    const recent = ["question", "bold_statement", "direct_address"];
    const avoided = new Set(recent);
    // Run 50 times to reduce flakiness from randomness
    for (let i = 0; i < 50; i++) {
      const result = selectHookStrategy(recent);
      expect(avoided.has(result)).toBe(false);
    }
  });

  it("should pick from all 8 when empty array provided", () => {
    const result = selectHookStrategy([]);
    expect(HOOK_STRATEGY_KEYS).toContain(result);
  });

  it("should only exclude existing entries when fewer than 3 recent", () => {
    const recent = ["question"];
    // With lookback of 3, only "question" is avoided
    for (let i = 0; i < 50; i++) {
      const result = selectHookStrategy(recent);
      expect(result).not.toBe("question");
    }
  });

  it("should ignore corrupted/invalid hook_strategy values in history", () => {
    const recent = ["INVALID", "not_a_hook", "garbage"];
    // All invalid — should pick from full 8
    const result = selectHookStrategy(recent);
    expect(HOOK_STRATEGY_KEYS).toContain(result);
  });

  it("should only avoid the last 3 even when more history is provided", () => {
    // 5 entries — only last 3 should be avoided
    const recent = [
      "question",
      "bold_statement",
      "direct_address",
      "curiosity_gap",
      "seasonal",
    ];
    const avoided = new Set(recent.slice(-3)); // direct_address, curiosity_gap, seasonal
    for (let i = 0; i < 50; i++) {
      const result = selectHookStrategy(recent);
      expect(avoided.has(result)).toBe(false);
    }
  });

  it("batch of 6 posts should never have two consecutive identical hooks", () => {
    const used: string[] = [];
    for (let i = 0; i < 6; i++) {
      const hook = selectHookStrategy(used);
      if (used.length > 0) {
        expect(hook).not.toBe(used[used.length - 1]);
      }
      used.push(hook);
    }
  });
});

describe("getHookInstruction", () => {
  it("should return the correct instruction for each strategy", () => {
    for (const key of HOOK_STRATEGY_KEYS) {
      const instruction = getHookInstruction(key);
      expect(instruction).toBe(HOOK_STRATEGIES[key]);
      expect(instruction.length).toBeGreaterThan(0);
    }
  });
});

describe("HOOK_INSTRUCTIONS coverage", () => {
  it("should have an instruction for every strategy key", () => {
    for (const key of HOOK_STRATEGY_KEYS) {
      expect(HOOK_STRATEGIES[key]).toBeDefined();
      expect(typeof HOOK_STRATEGIES[key]).toBe("string");
    }
  });
});

describe("hookStrategySchema", () => {
  it("should accept valid strategies", () => {
    for (const key of HOOK_STRATEGY_KEYS) {
      expect(hookStrategySchema.parse(key)).toBe(key);
    }
  });

  it("should reject invalid strategies", () => {
    expect(() => hookStrategySchema.parse("injected_value")).toThrow();
    expect(() => hookStrategySchema.parse("")).toThrow();
  });
});
