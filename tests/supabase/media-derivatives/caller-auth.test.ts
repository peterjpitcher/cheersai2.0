import { describe, expect, it } from "vitest";

import { isServiceRoleCaller } from "../../../supabase/functions/media-derivatives/caller-auth";

/**
 * The media-derivatives edge function runs with verify_jwt off, so this check is the only thing
 * between the public function URL and a reprocessing run. It must accept exactly
 * `Bearer <service-role key>` and refuse everything else, including when the expected key is
 * empty.
 */

// Fixture only, not a real key. Dotted like the real (JWT) key so the parsing sees the same shape.
const SERVICE_ROLE_KEY = "fixture-header.fixture-service-role-payload.fixture-signature";

describe("isServiceRoleCaller", () => {
  it("accepts Bearer with the service-role key", async () => {
    await expect(isServiceRoleCaller(`Bearer ${SERVICE_ROLE_KEY}`, SERVICE_ROLE_KEY)).resolves.toBe(true);
  });

  it("accepts the scheme in any case and extra spaces around the key", async () => {
    await expect(isServiceRoleCaller(`bearer ${SERVICE_ROLE_KEY}`, SERVICE_ROLE_KEY)).resolves.toBe(true);
    await expect(isServiceRoleCaller(`BEARER   ${SERVICE_ROLE_KEY}  `, SERVICE_ROLE_KEY)).resolves.toBe(true);
  });

  it("refuses a request with no Authorization header", async () => {
    await expect(isServiceRoleCaller(null, SERVICE_ROLE_KEY)).resolves.toBe(false);
    await expect(isServiceRoleCaller("", SERVICE_ROLE_KEY)).resolves.toBe(false);
  });

  it("refuses a wrong key, including near misses", async () => {
    const lastChar = SERVICE_ROLE_KEY.slice(-1);
    const nearMisses = [
      "some-other-key",
      `${SERVICE_ROLE_KEY.slice(0, -1)}${lastChar === "x" ? "y" : "x"}`, // one character changed
      SERVICE_ROLE_KEY.slice(0, -1), // truncated
      `${SERVICE_ROLE_KEY}x`, // extended
      SERVICE_ROLE_KEY.toUpperCase(), // keys are case-sensitive
    ];

    for (const key of nearMisses) {
      await expect(isServiceRoleCaller(`Bearer ${key}`, SERVICE_ROLE_KEY)).resolves.toBe(false);
    }
  });

  it("refuses the right key without the Bearer scheme", async () => {
    await expect(isServiceRoleCaller(SERVICE_ROLE_KEY, SERVICE_ROLE_KEY)).resolves.toBe(false);
    await expect(isServiceRoleCaller(`Basic ${SERVICE_ROLE_KEY}`, SERVICE_ROLE_KEY)).resolves.toBe(false);
    await expect(isServiceRoleCaller("Bearer", SERVICE_ROLE_KEY)).resolves.toBe(false);
    await expect(isServiceRoleCaller("Bearer ", SERVICE_ROLE_KEY)).resolves.toBe(false);
  });

  it("refuses two credentials in one header", async () => {
    await expect(
      isServiceRoleCaller(`Bearer ${SERVICE_ROLE_KEY}, Bearer ${SERVICE_ROLE_KEY}`, SERVICE_ROLE_KEY),
    ).resolves.toBe(false);
  });

  it("fails closed when the expected key is empty or unset", async () => {
    for (const expectedKey of ["", undefined]) {
      await expect(isServiceRoleCaller(`Bearer ${SERVICE_ROLE_KEY}`, expectedKey)).resolves.toBe(false);
      await expect(isServiceRoleCaller("Bearer ", expectedKey)).resolves.toBe(false);
      await expect(isServiceRoleCaller("Bearer undefined", expectedKey)).resolves.toBe(false);
      await expect(isServiceRoleCaller(null, expectedKey)).resolves.toBe(false);
    }
  });

  it("refuses everything when the expected key is only whitespace", async () => {
    await expect(isServiceRoleCaller("Bearer  ", " ")).resolves.toBe(false);
    await expect(isServiceRoleCaller(`Bearer ${SERVICE_ROLE_KEY}`, " ")).resolves.toBe(false);
  });
});
