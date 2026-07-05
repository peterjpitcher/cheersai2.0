// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadPlannerMediaLibraryMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("@/app/(app)/planner/actions", () => ({
  loadPlannerMediaLibrary: (...args: unknown[]) => loadPlannerMediaLibraryMock(...args),
}));

vi.mock("@/features/planner/content-media-editor", () => ({
  PlannerContentMediaEditor: () => <div>Media editor loaded</div>,
}));

import { PlannerMediaSwapButton } from "@/features/planner/planner-media-swap-button";

describe("<PlannerMediaSwapButton />", () => {
  beforeEach(() => {
    loadPlannerMediaLibraryMock.mockReset();
    routerRefreshMock.mockReset();
    loadPlannerMediaLibraryMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("loads attached asset ids and renders a bounded scroll modal", async () => {
    const hiddenAssetId = "22222222-2222-4222-8222-222222222222";

    render(
      <PlannerMediaSwapButton
        contentId="11111111-1111-4111-8111-111111111111"
        initialMedia={[{ id: hiddenAssetId, mediaType: "image", fileName: "hidden.png" }]}
        placement="feed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(loadPlannerMediaLibraryMock).toHaveBeenCalledWith({ includeAssetIds: [hiddenAssetId] });
    });

    expect(await screen.findByText("Media editor loaded")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("overflow-hidden");

    const panel = dialog.children[1] as HTMLElement;
    expect(panel.className).toContain("max-h-[calc(100vh-2rem)]");
    expect(panel.className).toContain("flex-col");

    const body = panel.children[1] as HTMLElement;
    expect(body.className).toContain("overflow-y-auto");
  });
});
