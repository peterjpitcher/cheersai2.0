import { describe, expect, it } from "vitest";

import { formatPlatformLabel } from "@/features/planner/utils";

describe("formatPlatformLabel", () => {
  it("labels known platforms", () => {
    expect(formatPlatformLabel("facebook")).toBe("Facebook");
    expect(formatPlatformLabel("instagram")).toBe("Instagram");
  });

  it("falls back to 'No platform' for a null/undefined platform", () => {
    // content_items.platform is nullable (multi-platform drafts, legacy rows).
    expect(formatPlatformLabel(null)).toBe("No platform");
    expect(formatPlatformLabel(undefined)).toBe("No platform");
  });
});
