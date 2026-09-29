import { describe, expect, it } from "vitest";

import { adsConnectErrorMessage } from "./messages";

describe("adsConnectErrorMessage", () => {
  it("turns the Meta Ads callback's codes into plain words", () => {
    expect(adsConnectErrorMessage("invalid_state")).toBe(
      "This connection link has expired or was already used. Please click Connect Meta Ads again.",
    );
    expect(adsConnectErrorMessage("token_exchange_failed")).toBe(
      "Facebook did not finish the sign-in. Please click Connect Meta Ads again.",
    );
    expect(adsConnectErrorMessage("db_error")).toBe(
      "We could not save your Meta Ads connection. Please click Connect Meta Ads again.",
    );
  });

  it("reads Meta's own error values, and anything unknown, as a cancelled sign-in", () => {
    const cancelled = "The Facebook sign-in was cancelled or did not finish. Please click Connect Meta Ads again.";
    expect(adsConnectErrorMessage("access_denied")).toBe(cancelled);
    expect(adsConnectErrorMessage("OAuthException: Error validating verification code (code 100)")).toBe(cancelled);
    // Never an inherited property name.
    expect(adsConnectErrorMessage("toString")).toBe(cancelled);
  });
});
