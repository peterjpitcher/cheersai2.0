/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { PageChoiceView, PageChooserState } from "@/lib/connections/page-choice-view";

const choosePageMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const initiateMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/(app)/connections/page-choice-actions", () => ({
  choosePageForConnection: choosePageMock,
}));

vi.mock("@/app/(app)/connections/actions", () => ({
  initiateOAuthConnect: initiateMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

import { PageChooser } from "./page-chooser";

const TOKEN = "R".repeat(43);

function view(overrides: Partial<PageChoiceView> = {}): PageChoiceView {
  return {
    token: TOKEN,
    provider: "facebook",
    changePage: false,
    brandName: "The Crown",
    instagramConnected: false,
    options: [
      {
        id: "101",
        name: "The Crown",
        instagramUsername: "thecrown",
        hasInstagram: true,
        selectable: true,
        connectedNow: false,
        note: null,
        instagramEffect: null,
      },
      {
        id: "202",
        name: "Crown Events",
        instagramUsername: null,
        hasInstagram: false,
        selectable: false,
        connectedNow: false,
        note: "Your Facebook profile cannot post to this Page.",
        instagramEffect: null,
      },
    ],
    ...overrides,
  };
}

function choose(overrides: Partial<PageChoiceView> = {}): PageChooserState {
  return { kind: "choose", view: view(overrides) };
}

/** What the server renders on reload once the choice is used up. */
const usedUp: PageChooserState = {
  kind: "unavailable",
  message: "This Page choice has already been used. If your Page is not connected yet, start again from the Connections screen.",
  provider: "facebook",
  changePage: false,
  canStartAgain: false,
};

function pickAndConnect(name: RegExp = /The Crown/) {
  fireEvent.click(screen.getByLabelText(name));
  fireEvent.click(screen.getByRole("button", { name: "Connect this Page" }));
}

describe("PageChooser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("lists each Page with whether it has a linked Instagram account", () => {
    render(<PageChooser state={choose()} />);

    expect(screen.getByLabelText(/The Crown/)).not.toBeNull();
    expect(screen.getByText("Instagram: @thecrown")).not.toBeNull();
    expect(screen.getByText("No Instagram account linked")).not.toBeNull();
  });

  it("disables a Page that cannot be connected and says why", () => {
    render(<PageChooser state={choose()} />);

    const events = screen.getByLabelText(/Crown Events/) as HTMLInputElement;
    expect(events.disabled).toBe(true);
    expect(screen.getByText("Your Facebook profile cannot post to this Page.")).not.toBeNull();
  });

  it("keeps the button disabled until the owner picks a Page", () => {
    render(<PageChooser state={choose()} />);

    const button = screen.getByRole("button", { name: "Connect this Page" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/The Crown/));
    expect(button.disabled).toBe(false);
  });

  it("connects the chosen Page and returns to Connections with the notice", async () => {
    choosePageMock.mockResolvedValue({ success: true, provider: "facebook", notice: "Instagram now uses @thecrown, on the same Page." });
    render(<PageChooser state={choose()} />);

    pickAndConnect();

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(choosePageMock).toHaveBeenCalledWith({ choice: TOKEN, pageId: "101" });
    const target = new URL(replaceMock.mock.calls[0][0], "https://app.test");
    expect(target.pathname).toBe("/connections");
    expect(target.searchParams.get("oauth")).toBe("success");
    expect(target.searchParams.get("provider")).toBe("facebook");
    expect(target.searchParams.get("message")).toBe("Instagram now uses @thecrown, on the same Page.");
    expect(screen.getByRole("status").textContent).toBe("Connected. Taking you back to Connections…");
  });

  it("shows a refusal with Start again and a way back", async () => {
    choosePageMock.mockResolvedValue({ success: false, error: "This Page choice has expired. Start again to see your Pages." });
    render(<PageChooser state={choose({ changePage: true })} />);

    pickAndConnect();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This Page choice has expired. Start again to see your Pages.");
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to Connections" }).getAttribute("href")).toBe("/connections");

    initiateMock.mockResolvedValue({ success: false, error: "nope" });
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    await waitFor(() => expect(initiateMock).toHaveBeenCalledWith("facebook", { changePage: true }));
  });

  // Found by running the page: picking uses the choice up, and Next.js may
  // re-render the page after the action, which then reads as "already used".
  it("keeps its own error when the server re-renders the page as used up", async () => {
    choosePageMock.mockResolvedValue({ success: false, error: "We could not check your Pages with Facebook. Please start again." });
    const { rerender } = render(<PageChooser state={choose()} />);

    pickAndConnect();
    await screen.findByRole("alert");
    rerender(<PageChooser state={usedUp} />);

    expect(screen.getByRole("alert").textContent).toBe("We could not check your Pages with Facebook. Please start again.");
    expect(screen.getByRole("button", { name: "Start again" })).not.toBeNull();
  });

  it("keeps its own error when the re-render lands before the action result", async () => {
    let finish: (value: unknown) => void = () => {};
    choosePageMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { rerender } = render(<PageChooser state={choose()} />);

    pickAndConnect();
    rerender(<PageChooser state={usedUp} />);
    finish({ success: false, error: "Your Facebook profile no longer manages The Crown." });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Your Facebook profile no longer manages The Crown."),
    );
  });

  it("keeps the success message when the server re-renders the page as used up", async () => {
    choosePageMock.mockResolvedValue({ success: true, provider: "facebook" });
    const { rerender } = render(<PageChooser state={choose()} />);

    pickAndConnect();
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    rerender(<PageChooser state={usedUp} />);

    expect(screen.getByRole("status").textContent).toBe("Connected. Taking you back to Connections…");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a general error when the action itself fails", async () => {
    choosePageMock.mockRejectedValue(new Error("network"));
    render(<PageChooser state={choose()} />);

    pickAndConnect();

    expect((await screen.findByRole("alert")).textContent).toBe("We could not finish this. Please start again.");
  });

  it("shows the server's reason on a fresh load, with Start again only when it helps", () => {
    const { rerender } = render(<PageChooser state={usedUp} />);
    expect(screen.getByRole("alert").textContent).toContain("already been used");
    expect(screen.queryByRole("button", { name: "Start again" })).toBeNull();

    rerender(
      <PageChooser
        state={{ kind: "unavailable", message: "This Page choice has expired. Start again to see your Pages.", provider: "instagram", changePage: false, canStartAgain: true }}
      />,
    );
    expect(screen.getByRole("button", { name: "Start again" })).not.toBeNull();
  });

  it("warns that Instagram follows the Page when it is connected", () => {
    render(
      <PageChooser
        state={choose({
          instagramConnected: true,
          options: [
            {
              id: "101",
              name: "The Crown",
              instagramUsername: "thecrown",
              hasInstagram: true,
              selectable: true,
              connectedNow: true,
              note: null,
              instagramEffect: null,
            },
            {
              id: "303",
              name: "Crown Kitchen",
              instagramUsername: null,
              hasInstagram: false,
              selectable: true,
              connectedNow: false,
              note: null,
              instagramEffect: "Instagram will be disconnected, as this Page has no account CheersAI can post to.",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText(/Instagram uses the same Page as Facebook/)).not.toBeNull();
    expect(screen.getByText("Connected now")).not.toBeNull();
    expect(screen.getByText("Instagram will be disconnected, as this Page has no account CheersAI can post to.")).not.toBeNull();
  });

  it("explains how to share more Pages when Facebook shared only one", () => {
    render(<PageChooser state={choose({ changePage: true, options: [view().options[0]] })} />);

    expect(screen.getByText(/Facebook shared only one Page with CheersAI/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Start again" })).not.toBeNull();
  });
});
