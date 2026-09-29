import { describe, expect, it } from "vitest";

import { OwnerRequiredError } from "@/lib/auth/roles";
import { EntitlementError } from "@/lib/billing/entitlement-server";
import { toLoggableError } from "@/lib/logging/to-error";

import { ownerMessage } from "./owner-message";

describe("ownerMessage", () => {
  const fallback = "We could not save your draft. Please try again.";

  it("passes through messages written for owners", () => {
    expect(ownerMessage(new OwnerRequiredError(), fallback)).toBe("Only an owner of this brand can do that.");
    expect(ownerMessage(new EntitlementError("suspended"), fallback)).toBe("This brand is on hold. Contact Cheers support.");
  });

  it("replaces any other error text with the plain fallback", () => {
    expect(ownerMessage(new Error('duplicate key value violates unique constraint "content_items_pkey"'), fallback)).toBe(fallback);
    expect(ownerMessage({ message: "JWT expired", code: "PGRST301" }, fallback)).toBe(fallback);
    expect(ownerMessage("boom", fallback)).toBe(fallback);
  });
});

describe("toLoggableError", () => {
  it("keeps a Supabase error's message and code for the log", () => {
    const error = toLoggableError({ message: "connection refused", code: "08006", details: null });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("connection refused (code 08006)");
  });

  it("returns an Error as it is, and stringifies anything else", () => {
    const original = new Error("fetch failed");
    expect(toLoggableError(original)).toBe(original);
    expect(toLoggableError("timeout").message).toBe("timeout");
  });
});
