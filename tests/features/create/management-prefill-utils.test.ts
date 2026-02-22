import { describe, expect, it } from "vitest";

import { findOverwriteConflicts } from "@/features/create/management-prefill-utils";

describe("findOverwriteConflicts", () => {
  it("returns fields where mapped and current values are both populated and different", () => {
    const conflicts = findOverwriteConflicts(
      {
        name: "Imported Quiz Night",
        description: "Imported description",
      },
      {
        name: "Existing Quiz Night",
        description: "Imported description",
      },
    );

    expect(conflicts).toEqual(["name"]);
  });

  it("ignores blank mapped values and blank current values", () => {
    const conflicts = findOverwriteConflicts(
      {
        name: "",
        startDate: "2026-03-12",
      },
      {
        name: "Existing title",
        startDate: "",
      },
    );

    expect(conflicts).toEqual([]);
  });

  it("normalizes whitespace before comparing", () => {
    const conflicts = findOverwriteConflicts(
      {
        prompt: "  Mention local suppliers  ",
      },
      {
        prompt: "Mention local suppliers",
      },
    );

    expect(conflicts).toEqual([]);
  });
});
