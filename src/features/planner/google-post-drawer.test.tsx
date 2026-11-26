// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GooglePostDrawer } from "@/features/planner/google-post-drawer";
import type { GoogleVersionView } from "@/lib/google-posts/model";
import type { GooglePostDetail } from "@/lib/google-posts/post-detail";

const GOOGLE_ID = "5b0d2d0e-3a1c-4c58-9f0a-2f6a3a0f3c11";
const CONTENT_ID = "9c0d2d0e-3a1c-4c58-9f0a-2f6a3a0f3c22";

const actions = vi.hoisted(() => ({
  loadGooglePostDetail: vi.fn(),
  moveGoogleVersion: vi.fn(),
  editGoogleVersionWording: vi.fn(),
  releaseGoogleVersion: vi.fn(),
  retryGoogleVersion: vi.fn(),
  skipGoogleVersion: vi.fn(),
}));

vi.mock("@/app/(app)/planner/google-version-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/providers/toast-provider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

function makeVersion(overrides: Partial<GoogleVersionView> = {}): GoogleVersionView {
  return {
    id: GOOGLE_ID,
    contentItemId: CONTENT_ID,
    state: "pending",
    holdReason: null,
    statusLine: "Will go to Google at the same time as the Facebook post.",
    summary: "Sunday roast is tomorrow from 1pm to 6pm.",
    summaryEdited: true,
    wordingSource: "ai",
    topicType: "STANDARD",
    eventTitle: null,
    eventStart: null,
    eventEnd: null,
    button: { type: "LEARN_MORE", url: "https://example.com/roast" },
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

function makeDetail(overrides: Partial<GooglePostDetail> = {}): GooglePostDetail {
  const version = makeVersion();
  return {
    version,
    section: { kind: "ready", version },
    title: "Sunday roast",
    // 11:00 in London in winter (GMT).
    currentTime: "2026-11-28T11:00:00.000Z",
    imageUrl: "https://example.com/roast.jpg",
    parentId: CONTENT_ID,
    timezone: "Europe/London",
    timezoneLabel: "Europe/London",
    ...overrides,
  };
}

function renderDrawer(googlePostId: string | null = GOOGLE_ID, open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GooglePostDrawer googlePostId={googlePostId} open={open} onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("<GooglePostDrawer />", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the Google post in a drawer: picture, time, wording, and links to the Facebook post and the full page", async () => {
    actions.loadGooglePostDetail.mockResolvedValue({ detail: makeDetail() });
    renderDrawer();

    expect(await screen.findByText("Sunday roast")).toBeInTheDocument();
    expect(actions.loadGooglePostDetail).toHaveBeenCalledWith({ id: GOOGLE_ID });
    expect(screen.getByText("Saturday 28 November 2026, 11:00")).toBeInTheDocument();
    expect(screen.getByAltText("The picture this Google post is sent with")).toHaveAttribute("src", "https://example.com/roast.jpg");
    expect(screen.getByLabelText("Google wording")).toHaveValue("Sunday roast is tomorrow from 1pm to 6pm.");
    expect(screen.getByText(/Written for Google by the AI/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Facebook post" })).toHaveAttribute("href", `/planner/${CONTENT_ID}`);
    expect(screen.getByRole("link", { name: "Open full page" })).toHaveAttribute("href", `/planner/google/${GOOGLE_ID}`);
  });

  it("reads the post again after its time is changed, so the drawer shows the new time", async () => {
    actions.loadGooglePostDetail
      .mockResolvedValueOnce({ detail: makeDetail() })
      .mockResolvedValue({
        detail: makeDetail({ currentTime: "2026-11-28T12:30:00.000Z", version: makeVersion({ ownTime: "2026-11-28T12:30:00.000Z" }) }),
      });
    actions.moveGoogleVersion.mockResolvedValue({ success: true, version: makeVersion({ ownTime: "2026-11-28T12:30:00.000Z" }) });
    renderDrawer();

    fireEvent.change(await screen.findByLabelText(/^Time/), { target: { value: "12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save time" }));

    await waitFor(() => expect(actions.moveGoogleVersion).toHaveBeenCalledWith({ contentId: CONTENT_ID, scheduledFor: "2026-11-28T12:30:00.000Z" }));
    await waitFor(() => expect(actions.loadGooglePostDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Saturday 28 November 2026, 12:30")).toBeInTheDocument();
  });

  it("says so plainly when the post cannot be found or cannot be loaded, and loads nothing while closed", async () => {
    actions.loadGooglePostDetail.mockResolvedValue({ detail: null });
    const first = renderDrawer();
    expect(await screen.findByText("This Google post could not be found.")).toBeInTheDocument();
    first.unmount();

    actions.loadGooglePostDetail.mockResolvedValue({ detail: null, error: "We could not load this Google post. Please try again." });
    const second = renderDrawer();
    expect(await screen.findByText("We could not load this Google post. Please try again.")).toBeInTheDocument();
    second.unmount();

    actions.loadGooglePostDetail.mockClear();
    renderDrawer(GOOGLE_ID, false);
    expect(actions.loadGooglePostDetail).not.toHaveBeenCalled();
  });
});
