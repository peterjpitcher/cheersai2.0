import { describe, expect, it } from "vitest";

// DEPRECATED: v1 completeConnectionOAuth was replaced by v2 completeOAuthConnect
// in plan 03-04. The v2 API stores tokens in token vault instead of plaintext columns.
// See src/app/(app)/connections/actions.test.ts for current test coverage.
describe.skip("completeConnectionOAuth (v1 - DEPRECATED)", () => {
  it("was replaced by completeOAuthConnect in v2", () => {
    expect(true).toBe(true);
  });
});
