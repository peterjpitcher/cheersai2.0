import { describe, expect, it, vi } from "vitest";

import { closeMediaSwapModalAndRefresh } from "@/features/create/media-swap-utils";

describe("closeMediaSwapModalAndRefresh", () => {
  it("closes the modal before refreshing", async () => {
    const calls: string[] = [];
    const onClose = () => {
      calls.push("close");
    };
    const onRefresh = vi.fn(async () => {
      calls.push("refresh");
    });

    await closeMediaSwapModalAndRefresh({
      contentId: "content-1",
      onClose,
      onRefresh,
    });

    expect(onRefresh).toHaveBeenCalledWith("content-1");
    expect(calls).toEqual(["close", "refresh"]);
  });

  it("swallows refresh errors and reports them", async () => {
    const refreshError = new Error("refresh failed");
    const onClose = vi.fn();
    const onRefresh = vi.fn(async () => {
      throw refreshError;
    });
    const onRefreshError = vi.fn();

    await closeMediaSwapModalAndRefresh({
      contentId: "content-2",
      onClose,
      onRefresh,
      onRefreshError,
    });

    expect(onClose).toHaveBeenCalled();
    expect(onRefreshError).toHaveBeenCalledWith(refreshError);
  });
});

