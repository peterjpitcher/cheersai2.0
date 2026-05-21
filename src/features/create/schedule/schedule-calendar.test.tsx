// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMinimumScheduleSlot,
  ScheduleCalendar,
} from "@/features/create/schedule/schedule-calendar";

describe("ScheduleCalendar", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("rounds the 10-minute minimum to the next schedulable minute", () => {
    const now = DateTime.fromISO("2026-05-21T20:18:19", { zone: "Europe/London" });

    expect(getMinimumScheduleSlot(now).toFormat("HH:mm")).toBe("20:29");
  });

  it("offers a dynamic 10-minute slot when fixed presets are not enough", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T19:18:19Z"));

    const onAddSlot = vi.fn();

    render(
      <ScheduleCalendar
        timezone="Europe/London"
        initialMonth="2026-05"
        selected={[]}
        onAddSlot={onAddSlot}
        onRemoveSlot={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Add custom slot for 21 May"));
    fireEvent.click(screen.getByRole("button", { name: "In 10 min · 20:29" }));

    expect(onAddSlot).toHaveBeenCalledWith({ date: "2026-05-21", time: "20:29" });
  });
});
