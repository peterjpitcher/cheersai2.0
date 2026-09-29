import { describe, expect, it } from "vitest";

import { redactMetaAccessTokens } from "@/lib/meta/redact";

describe("redactMetaAccessTokens", () => {
  it("removes anything shaped like a Meta access token", () => {
    const token = "EAABsbCS1iHgBAKZCZBZCxyz0123456789_-abc";
    expect(redactMetaAccessTokens(`Invalid token ${token} (code 190)`)).toBe("Invalid token [redacted token] (code 190)");
    expect(redactMetaAccessTokens(`access_token=${token}&fields=id`)).toBe("access_token=[redacted token]&fields=id");
  });

  it("removes every token, not just the first", () => {
    expect(redactMetaAccessTokens("EAAG1111111111 and EAAG2222222222")).toBe("[redacted token] and [redacted token]");
  });

  it("leaves ordinary error text alone", () => {
    const text = "OAuthException: Error validating access token: Session has expired (code 190)";
    expect(redactMetaAccessTokens(text)).toBe(text);
    expect(redactMetaAccessTokens("EAA is short")).toBe("EAA is short");
  });
});
