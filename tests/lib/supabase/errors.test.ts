import { describe, expect, it } from "vitest";

import { isSchemaMissingError } from "@/lib/supabase/errors";

describe("isSchemaMissingError", () => {
  it("returns true for missing relation errors (42P01)", () => {
    expect(isSchemaMissingError({ code: "42P01" })).toBe(true);
  });

  it("returns true for missing column errors (42703)", () => {
    expect(isSchemaMissingError({ code: "42703" })).toBe(true);
  });

  it("returns false for other error codes", () => {
    expect(isSchemaMissingError({ code: "42501" })).toBe(false);
  });

  it("returns false when no code is present", () => {
    expect(isSchemaMissingError({})).toBe(false);
  });
});
