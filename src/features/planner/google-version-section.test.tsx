// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleVersionSection } from "@/features/planner/google-version-section";
import type { GoogleVersionView } from "@/lib/google-posts/model";

const CONTENT_ID = "0b6f5f4e-1c2d-4a3b-9e8f-7a6b5c4d3e2f";

const mocks = vi.hoisted(() => ({
  editGoogleVersionWording: vi.fn(),
  releaseGoogleVersion: vi.fn(),
  retryGoogleVersion: vi.fn(),
  skipGoogleVersion: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("@/app/(app)/planner/google-version-actions", () => ({
  editGoogleVersionWording: mocks.editGoogleVersionWording,
  releaseGoogleVersion: mocks.releaseGoogleVersion,
  retryGoogleVersion: mocks.retryGoogleVersion,
  skipGoogleVersion: mocks.skipGoogleVersion,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/providers/toast-provider", () => ({ useToast: () => mocks.toast }));

function makeVersion(overrides: Partial<GoogleVersionView> = {}): GoogleVersionView {
  return {
    id: "v1",
    contentItemId: CONTENT_ID,
    state: "pending",
    holdReason: null,
    statusLine: "Will go to Google at the same time as the Facebook post.",
    summary: "Quiz night this Thursday from 8pm.",
    summaryEdited: false,
    wordingSource: "facebook",
    topicType: "STANDARD",
    eventTitle: null,
    eventStart: null,
    eventEnd: null,
    button: { type: "LEARN_MORE", url: "https://example.com/quiz" },
    ownTime: null,
    canMove: true,
    googleUrl: null,
    googleState: null,
    lastError: null,
    canEdit: true,
    canRelease: false,
    canSkip: true,
    canRetry: false,
    ...overrides,
  };
}

function renderReady(version: GoogleVersionView | null) {
  render(<GoogleVersionSection section={{ kind: "ready", version }} timezone="Europe/London" />);
}

function buttonNames(): string[] {
  return screen.queryAllByRole("button").map((button) => button.textContent?.trim() ?? "");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("<GoogleVersionSection />", () => {
  it("shows a waiting update with its wording, counter, button and link, and only Save and Skip", () => {
    renderReady(makeVersion());

    expect(screen.getByText("Waiting for its time")).toBeInTheDocument();
    expect(screen.getByText("Will go to Google at the same time as the Facebook post.")).toBeInTheDocument();
    expect(screen.getByLabelText("Google wording")).toHaveValue("Quiz night this Thursday from 8pm.");
    expect(screen.getByText("34 / 1,500")).toBeInTheDocument();
    expect(screen.getByText("Update")).toBeInTheDocument();
    expect(screen.getByText("Learn more")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com/quiz" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Follows the Facebook wording/)).toBeInTheDocument();
    expect(buttonNames()).toEqual(["Save wording", "Skip"]);
    expect(screen.getByRole("button", { name: "Save wording" })).toBeDisabled();
  });

  it("shows an event's title and London times", () => {
    renderReady(
      makeVersion({
        topicType: "EVENT",
        eventTitle: "Music Bingo",
        eventStart: "2026-11-21T19:00:00.000Z",
        eventEnd: "2026-11-21T22:00:00.000Z",
        button: { type: "BOOK", url: "https://example.com/book" },
      }),
    );

    expect(screen.getByText("Event: Music Bingo")).toBeInTheDocument();
    expect(screen.getByText("Saturday 21 November 2026, 19:00 to 22:00")).toBeInTheDocument();
    expect(screen.getByText("Book")).toBeInTheDocument();
  });

  it("saves the wording, shows what Google will get and refreshes", async () => {
    mocks.editGoogleVersionWording.mockResolvedValue({
      success: true,
      version: makeVersion({ summary: "Quiz tonight!", summaryEdited: true }),
    });
    renderReady(makeVersion());

    fireEvent.change(screen.getByLabelText("Google wording"), { target: { value: "Quiz tonight! #quiz" } });
    fireEvent.click(screen.getByRole("button", { name: "Save wording" }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(mocks.editGoogleVersionWording).toHaveBeenCalledWith({ contentId: CONTENT_ID, summary: "Quiz tonight! #quiz" });
    expect(mocks.toast.success.mock.calls[0][0]).toBe("Google wording saved");
    expect(mocks.toast.success.mock.calls[0][1].description).toContain("were removed");
    expect(screen.getByLabelText("Google wording")).toHaveValue("Quiz tonight!");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("will not save more than 1,500 characters and says why", () => {
    renderReady(makeVersion());

    fireEvent.change(screen.getByLabelText("Google wording"), { target: { value: "a".repeat(1501) } });

    expect(screen.getByText("1,501 / 1,500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save wording" })).toBeDisabled();
    expect(screen.getByText(/Google allows 1,500 characters at most/)).toBeInTheDocument();
  });

  it("shows the action's own error in plain words and refreshes", async () => {
    mocks.editGoogleVersionWording.mockResolvedValue({
      success: false,
      error: "The Google wording can only be changed before it is sent.",
    });
    renderReady(makeVersion());

    fireEvent.change(screen.getByLabelText("Google wording"), { target: { value: "Something new." } });
    fireEvent.click(screen.getByRole("button", { name: "Save wording" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Could not save the Google wording", {
        description: "The Google wording can only be changed before it is sent.",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("never shows technical text when an action throws", async () => {
    mocks.retryGoogleVersion.mockRejectedValue(new Error("EntitlementError: plan lapsed (stack...)"));
    renderReady(makeVersion({ state: "failed", canEdit: false, canRetry: true, lastError: "Google refused this post." }));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Could not try again", { description: "Please try again." }));
  });

  it("offers Release on a held version, but only once the wording is saved", async () => {
    mocks.releaseGoogleVersion.mockResolvedValue({ success: true, version: makeVersion() });
    renderReady(
      makeVersion({
        state: "held",
        holdReason: "alcohol_promotion",
        statusLine: "This wording looks like a drinks price offer, which Google restricts.",
        canRelease: true,
      }),
    );

    expect(screen.getByText("Held")).toBeInTheDocument();
    expect(buttonNames()).toEqual(["Save wording", "Release", "Skip"]);

    fireEvent.change(screen.getByLabelText("Google wording"), { target: { value: "Quiz from 8pm." } });
    expect(screen.getByRole("button", { name: "Release" })).toBeDisabled();
    expect(screen.getByText("Save the wording before releasing it.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Google wording"), { target: { value: "Quiz night this Thursday from 8pm." } });
    fireEvent.click(screen.getByRole("button", { name: "Release" }));

    await waitFor(() => expect(mocks.releaseGoogleVersion).toHaveBeenCalledWith({ contentId: CONTENT_ID }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Released for Google", expect.any(Object)));
  });

  it("offers Retry and Skip on a failed version, with the reason and no edit box", () => {
    renderReady(
      makeVersion({
        state: "failed",
        statusLine: "Google refused this post.",
        lastError: "Google said the image was too small.",
        canEdit: false,
        canRetry: true,
      }),
    );

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Google said the image was too small.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(buttonNames()).toEqual(["Retry", "Skip"]);
  });

  it("asks before skipping, and does nothing if the person says no", async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    mocks.skipGoogleVersion.mockResolvedValue({ success: true, version: makeVersion({ state: "skipped" }) });
    renderReady(makeVersion());

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(mocks.skipGoogleVersion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(mocks.skipGoogleVersion).toHaveBeenCalledWith({ contentId: CONTENT_ID }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Google version skipped", expect.any(Object)));
  });

  it("links to the post on Google and shows Google's check once sent, with no buttons", () => {
    renderReady(
      makeVersion({
        state: "sent",
        statusLine: "Live on Google.",
        googleState: "LIVE",
        googleUrl: "https://local.google.com/place?id=1&use=posts&lpsid=2",
        canEdit: false,
        canSkip: false,
      }),
    );

    expect(screen.getByText("Posted")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /View the post on Google/ });
    expect(link).toHaveAttribute("href", "https://local.google.com/place?id=1&use=posts&lpsid=2");
    expect(link).toHaveAttribute("target", "_blank");
    expect(buttonNames()).toEqual([]);
  });

  it("does not show an old problem under a version a person skipped", () => {
    renderReady(
      makeVersion({
        state: "skipped",
        statusLine: "Someone chose not to send this to Google.",
        lastError: "Google refused this post.",
        canEdit: false,
        canSkip: false,
      }),
    );

    expect(screen.getByText("Someone chose not to send this to Google.")).toBeInTheDocument();
    expect(screen.queryByText("Google refused this post.")).toBeNull();
  });

  it.each([
    ["claimed", "Sending"],
    ["uncertain", "Could not confirm"],
    ["skipped", "Skipped"],
  ] as const)("shows a %s version as %s with no buttons", (state, label) => {
    renderReady(makeVersion({ state, canEdit: false, canSkip: false }));

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(buttonNames()).toEqual([]);
  });

  it("says plainly when the post has no Google version", () => {
    renderReady(null);

    expect(screen.getByText("This post has no Google version.")).toBeInTheDocument();
    expect(buttonNames()).toEqual([]);
  });

  it("shows a reconnect notice instead of the controls when Google needs reconnecting", () => {
    render(
      <GoogleVersionSection
        section={{ kind: "reconnect", version: makeVersion({ state: "held", canRelease: true }) }}
        timezone="Europe/London"
      />,
    );

    expect(screen.getByText(/Google is not connected, or needs reconnecting/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Connections/ })).toHaveAttribute("href", "/connections");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(buttonNames()).toEqual([]);
    expect(screen.getByText("Quiz night this Thursday from 8pm.")).toBeInTheDocument();
  });

  it("says it could not load, with no controls, when the read failed", () => {
    render(<GoogleVersionSection section={{ kind: "unavailable" }} timezone="Europe/London" />);

    expect(screen.getByText(/We could not load the Google version just now/)).toBeInTheDocument();
    expect(buttonNames()).toEqual([]);
  });
});
