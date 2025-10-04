import { describe, expect, it } from "vitest";

import { resolveConnectionMetadata } from "../supabase/functions/publish-queue/metadata";

describe("resolveConnectionMetadata", () => {
  it("returns metadata for facebook when pageId present", () => {
    const result = resolveConnectionMetadata("facebook", { pageId: "123" });
    expect(result).toEqual({ ok: true, metadata: { pageId: "123" } });
  });

  it("falls back to error when facebook pageId missing", () => {
    const result = resolveConnectionMetadata("facebook", {});
    expect(result).toEqual({ ok: false, error: "Facebook connection missing pageId metadata." });
  });

  it("accepts instagram igBusinessId or igUserId", () => {
    const result = resolveConnectionMetadata("instagram", { igUserId: "abc" });
    expect(result).toEqual({ ok: true, metadata: { igBusinessId: "abc" } });
  });

  it("requires locationId for GBP", () => {
    const result = resolveConnectionMetadata("gbp", null);
    expect(result).toEqual({ ok: false, error: "Google Business connection missing locationId metadata." });
  });
});
