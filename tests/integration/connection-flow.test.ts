import { describe, it, expect } from "vitest";

// DEPRECATED: v1 completeConnectionOAuth was replaced by v2 completeOAuthConnect
// in plan 03-04. The v2 API stores tokens in token vault instead of plaintext columns.
// See src/app/(app)/connections/actions.test.ts for current test coverage.
describe.skip("Connection OAuth Flow (v1 - DEPRECATED)", () => {
  it("was replaced by v2 OAuth flow with token vault", () => {
    expect(true).toBe(true);
  });
});
