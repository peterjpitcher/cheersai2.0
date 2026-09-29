// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CancelPostButton, PublishNowButton } from "@/features/planner/planner-post-actions";

const CONTENT_ID = "0b6f5f4e-1c2d-4a3b-9e8f-7a6b5c4d3e2f";

const mocks = vi.hoisted(() => ({
  publishPlannerContentNow: vi.fn(),
  deletePlannerContent: vi.fn(),
  restorePlannerContent: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("@/app/(app)/planner/actions", () => ({
  publishPlannerContentNow: mocks.publishPlannerContentNow,
  deletePlannerContent: mocks.deletePlannerContent,
  restorePlannerContent: mocks.restorePlannerContent,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => mocks.toast,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("<PublishNowButton />", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T08:00:20.000Z"));
  });

  it("sends the post, shows it is busy, confirms and refreshes the page", async () => {
    let resolve!: (value: unknown) => void;
    mocks.publishPlannerContentNow.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<PublishNowButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));

    const busy = await screen.findByRole("button", { name: "Publishing…" });
    expect(busy).toBeDisabled();
    expect(mocks.publishPlannerContentNow).toHaveBeenCalledWith({ contentId: CONTENT_ID });

    resolve({ ok: true, scheduledFor: "2026-09-27T08:01:00.000Z", timezone: "Europe/London", warning: null });

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Publishing now", {
      description: "It should go out within a couple of minutes.",
    }));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Publish now" })).toBeEnabled();
  });

  it("shows the reason when the post cannot be sent, and does not refresh", async () => {
    mocks.publishPlannerContentNow.mockResolvedValue({ error: "Connect Facebook before scheduling this post." });

    render(<PublishNowButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Could not publish", {
      description: "Connect Facebook before scheduling this post.",
    }));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("shows a plain error, never the thrown text, when the action fails outright", async () => {
    mocks.publishPlannerContentNow.mockRejectedValue(new Error("Content item not found"));

    render(<PublishNowButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Could not publish", {
      description: "Please try again.",
    }));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says when the post was moved to a later slot instead of going out now", async () => {
    mocks.publishPlannerContentNow.mockResolvedValue({
      ok: true,
      scheduledFor: "2026-09-27T08:31:00.000Z",
      timezone: "Europe/London",
      warning: null,
    });

    render(<PublishNowButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));

    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith("Scheduled for 09:31", expect.objectContaining({
      description: expect.stringContaining("next free slot"),
    })));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("passes on the copy warning without blocking the send", async () => {
    mocks.publishPlannerContentNow.mockResolvedValue({
      ok: true,
      scheduledFor: "2026-09-27T08:01:00.000Z",
      timezone: "Europe/London",
      warning: 'The copy says "tomorrow", which is no longer true.',
    });

    render(<PublishNowButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));

    await waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith("Publishing now, but check the copy", expect.objectContaining({
      description: 'The copy says "tomorrow", which is no longer true.',
    })));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("can be labelled as a retry", () => {
    render(<PublishNowButton contentId={CONTENT_ID} label="Try again now" variant="secondary" icon="retry" />);

    expect(screen.getByRole("button", { name: "Try again now" })).toBeInTheDocument();
  });
});

describe("<CancelPostButton />", () => {
  it("does nothing when the owner backs out of the confirmation", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<CancelPostButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel this post" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Cancel this post? It will not be published. It moves to Trash, where you can restore it.",
    );
    expect(mocks.deletePlannerContent).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("moves the post to Trash, offers Undo and returns to the planner", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    mocks.deletePlannerContent.mockResolvedValue({ ok: true, contentId: CONTENT_ID, deletedAt: "2026-09-27T08:00:20.000Z" });
    mocks.restorePlannerContent.mockResolvedValue({ ok: true });

    render(<CancelPostButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel this post" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/planner"));
    expect(mocks.deletePlannerContent).toHaveBeenCalledWith({ contentId: CONTENT_ID, onlyIfUnpublished: true });

    const [title, options] = mocks.toast.success.mock.calls[0];
    expect(title).toBe("Post cancelled");
    expect(options.action.label).toBe("Undo");

    await options.action.onClick();

    expect(mocks.restorePlannerContent).toHaveBeenCalledWith({ contentId: CONTENT_ID });
    expect(mocks.toast.success).toHaveBeenLastCalledWith("Post restored", { description: "The post is back in your planner." });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("stays on the page when the server refuses because the post is already going out", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    mocks.deletePlannerContent.mockResolvedValue({ error: "This post is being sent right now, so it can no longer be cancelled." });

    render(<CancelPostButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel this post" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Could not cancel post", {
      description: "This post is being sent right now, so it can no longer be cancelled.",
    }));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("stays on the page and shows a plain error when the post cannot be cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    mocks.deletePlannerContent.mockRejectedValue(new Error("Content item not found"));

    render(<CancelPostButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel this post" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Could not cancel post", {
      description: "Please try again.",
    }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("reports a failed Undo", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    mocks.deletePlannerContent.mockResolvedValue({ ok: true });
    mocks.restorePlannerContent.mockRejectedValue(new Error("Your subscription does not allow this."));

    render(<CancelPostButton contentId={CONTENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel this post" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());

    await mocks.toast.success.mock.calls[0][1].action.onClick();

    // A thrown action reaches the browser as React's generic text in production.
    expect(mocks.toast.error).toHaveBeenCalledWith("Could not restore post", {
      description: "Please try again.",
    });
  });
});
