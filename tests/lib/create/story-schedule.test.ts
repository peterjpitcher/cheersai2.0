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

  it("rolls past story dates to the next 07:00 slot", () => {
    const result = resolveStoryScheduledFor(
      "2026-05-02",
      TZ,
      DateTime.fromISO("2026-05-02T08:00:00", { zone: TZ }),
    );

    expect(DateTime.fromJSDate(result!, { zone: TZ }).toFormat("yyyy-LL-dd HH:mm")).toBe("2026-05-03 07:00");
  });
});
