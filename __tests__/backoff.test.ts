import { computeBackoffMinutes, nextAttemptDate } from "../lib/utils/backoff";

describe("computeBackoffMinutes", () => {
  test("returns 1 minute for invalid or <1 attempts", () => {
    expect(computeBackoffMinutes(0)).toBe(1);
    // @ts-expect-error
    expect(computeBackoffMinutes(undefined)).toBe(1);
  });

  test("exponential growth with cap", () => {
    expect(computeBackoffMinutes(1, 120)).toBe(2);
    expect(computeBackoffMinutes(2, 120)).toBe(4);
    expect(computeBackoffMinutes(3, 120)).toBe(8);
    expect(computeBackoffMinutes(6, 120)).toBe(64);
    expect(computeBackoffMinutes(7, 120)).toBe(120); // capped (128 -> 120)
  });
});

describe("nextAttemptDate", () => {
  test("computes date offset by backoff minutes", () => {
    const base = new Date("2025-01-01T00:00:00Z");
    const d = nextAttemptDate(base, 1, 60); // 2 minutes
    expect(d.toISOString()).toBe("2025-01-01T00:02:00.000Z");
  });
});

