import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

import { deletionConfirmationCode, parseMetaSignedRequest } from "./signed-request";

const SECRET = "test-app-secret";

function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return `${signature}.${encodedPayload}`;
}

const validPayload = {
  algorithm: "HMAC-SHA256",
  issued_at: 1_788_000_000,
  user_id: "1234567890",
};

describe("parseMetaSignedRequest", () => {
  it("accepts a correctly signed request and returns the payload", () => {
    const result = parseMetaSignedRequest(sign(validPayload), SECRET);
    expect(result).not.toBeNull();
    expect(result?.user_id).toBe("1234567890");
    expect(result?.issued_at).toBe(1_788_000_000);
  });

  it("rejects a request signed with a different secret", () => {
    expect(parseMetaSignedRequest(sign(validPayload, "wrong-secret"), SECRET)).toBeNull();
  });

  it("rejects a tampered payload whose signature no longer matches", () => {
    const signed = sign(validPayload);
    const [signature] = signed.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...validPayload, user_id: "9999999999" }),
    ).toString("base64url");
    expect(parseMetaSignedRequest(`${signature}.${forged}`, SECRET)).toBeNull();
  });

  it("rejects an algorithm other than HMAC-SHA256", () => {
    // A forged request must not be able to downgrade the algorithm.
    expect(parseMetaSignedRequest(sign({ ...validPayload, algorithm: "none" }), SECRET)).toBeNull();
  });

  it("accepts the algorithm case-insensitively", () => {
    expect(parseMetaSignedRequest(sign({ ...validPayload, algorithm: "hmac-sha256" }), SECRET))
      .not.toBeNull();
  });

  it("rejects a missing algorithm", () => {
    const withoutAlgorithm: Record<string, unknown> = { ...validPayload };
    delete withoutAlgorithm.algorithm;
    expect(parseMetaSignedRequest(sign(withoutAlgorithm), SECRET)).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "no-dot", "a.b.c", "...", "!!!.!!!"]) {
      expect(parseMetaSignedRequest(bad, SECRET)).toBeNull();
    }
  });

  it("rejects null and undefined", () => {
    expect(parseMetaSignedRequest(null, SECRET)).toBeNull();
    expect(parseMetaSignedRequest(undefined, SECRET)).toBeNull();
  });

  it("rejects when no app secret is configured, rather than trusting the request", () => {
    expect(parseMetaSignedRequest(sign(validPayload), "")).toBeNull();
  });

  it("rejects a payload that is not a JSON object", () => {
    for (const value of ["[1,2,3]", '"a string"', "42", "null"]) {
      const encoded = Buffer.from(value).toString("base64url");
      const signature = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");
      expect(parseMetaSignedRequest(`${signature}.${encoded}`, SECRET)).toBeNull();
    }
  });

  it("rejects a signature of the wrong length without throwing", () => {
    const signed = sign(validPayload);
    const [, encodedPayload] = signed.split(".");
    const shortSignature = Buffer.from("abc").toString("base64url");
    expect(parseMetaSignedRequest(`${shortSignature}.${encodedPayload}`, SECRET)).toBeNull();
  });
});

describe("deletionConfirmationCode", () => {
  it("is stable for the same user, so the status endpoint needs no storage", () => {
    expect(deletionConfirmationCode("123", SECRET)).toBe(deletionConfirmationCode("123", SECRET));
  });

  it("differs per user", () => {
    expect(deletionConfirmationCode("123", SECRET)).not.toBe(deletionConfirmationCode("456", SECRET));
  });

  it("depends on the app secret, so it cannot be produced by a third party", () => {
    expect(deletionConfirmationCode("123", SECRET)).not.toBe(deletionConfirmationCode("123", "other"));
  });

  it("does not leak the user id", () => {
    expect(deletionConfirmationCode("1234567890", SECRET)).not.toContain("1234567890");
  });
});
