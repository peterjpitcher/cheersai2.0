import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import { resolveStoryScheduledFor } from "@/lib/create/story-schedule";

const TZ = "Europe/London";

describe("resolveStoryScheduledFor", () => {
  it("sets story slots to 07:00 on the selected date", () => {
    const result = resolveStoryScheduledFor(
      "2026-05-10T18:45",
      TZ,
      DateTime.fromISO("2026-05-02T09:00:00", { zone: TZ }),
    );

    expect(DateTime.fromJSDate(result!, { zone: TZ }).toFormat("yyyy-LL-dd HH:mm")).toBe("2026-05-10 07:00");
  });

  it("uses the next valid time today when the 07:00 story slot has passed", () => {
    const result = resolveStoryScheduledFor(
      "2026-05-02",
      TZ,
      DateTime.fromISO("2026-05-02T08:00:00", { zone: TZ }),
    );

    expect(DateTime.fromJSDate(result!, { zone: TZ }).toFormat("yyyy-LL-dd HH:mm")).toBe("2026-05-02 08:15");
  });

  it("keeps today and tomorrow story dates distinct after today's 07:00 slot has passed", () => {
    const now = DateTime.fromISO("2026-05-02T16:23:00", { zone: TZ });
    const today = resolveStoryScheduledFor("2026-05-02", TZ, now);
    const tomorrow = resolveStoryScheduledFor("2026-05-03", TZ, now);

    expect(DateTime.fromJSDate(today!, { zone: TZ }).toFormat("yyyy-LL-dd HH:mm")).toBe("2026-05-02 16:38");
    expect(DateTime.fromJSDate(tomorrow!, { zone: TZ }).toFormat("yyyy-LL-dd HH:mm")).toBe("2026-05-03 07:00");
    expect(today?.toISOString()).not.toBe(tomorrow?.toISOString());
  });
});
