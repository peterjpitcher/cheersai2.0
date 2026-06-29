import { describe, expect, it } from "vitest";

import { evaluateConnectionMetadata } from "../src/lib/connections/metadata";

describe("evaluateConnectionMetadata", () => {
  it("flags missing Facebook pageId", () => {
    const result = evaluateConnectionMetadata("facebook", {});
    expect(result.complete).toBe(false);
    expect(result.missingKeys).toContain("pageId");
  });

  it("accepts populated Instagram business ID", () => {
    const result = evaluateConnectionMetadata("instagram", { igBusinessId: "123" });
    expect(result.complete).toBe(true);
    expect(result.missingKeys).toHaveLength(0);
  });
});
