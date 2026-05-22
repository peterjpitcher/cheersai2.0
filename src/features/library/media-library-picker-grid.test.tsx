// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaAssetSummary } from "@/lib/library/data";

const { hideMediaAssetsMock } = vi.hoisted(() => ({
  hideMediaAssetsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/(app)/library/actions", () => ({
  hideMediaAssets: (...args: unknown[]) => hideMediaAssetsMock(...args),
  hideMediaAssetsByTag: vi.fn(),
  updateMediaAsset: vi.fn(),
  deleteMediaAsset: vi.fn(),
}));

import { MediaLibraryPickerGrid } from "@/features/library/media-library-picker-grid";

function asset(overrides: Partial<MediaAssetSummary> & Pick<MediaAssetSummary, "id" | "fileName" | "tags">): MediaAssetSummary {
  return {
    mediaType: "image",
    uploadedAt: "2026-05-22T09:00:00.000Z",
    storagePath: `uploads/${overrides.id}.png`,
    processedStatus: "ready",
    derivedVariants: {},
    aspectClass: "square",
    previewShape: "square",
    previewUrl: `https://cdn.test/${overrides.id}/original.png`,
    ...overrides,
  };
}

describe("MediaLibraryPickerGrid", () => {
  beforeEach(() => {
    hideMediaAssetsMock.mockResolvedValue({ hiddenIds: ["music"], notFound: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("groups picker assets by tag and uses the smaller picker grid density", () => {
    const { container } = render(
      <MediaLibraryPickerGrid
        items={[
          asset({ id: "music", fileName: "Music Bingo.png", tags: ["music bingo"] }),
          asset({ id: "food", fileName: "Sunday Roast.png", tags: ["food"] }),
          asset({ id: "untagged", fileName: "Private Hire.png", tags: [] }),
        ]}
        selectedIds={["music"]}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText("#food").length).toBeGreaterThan(0);
    expect(screen.getAllByText("#music bingo").length).toBeGreaterThan(0);
    expect(screen.getByText("Untagged")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Music Bingo.png" })).toHaveAttribute(
      "src",
      "https://cdn.test/music/original.png",
    );
    expect(container.querySelector(".xl\\:grid-cols-6")).toBeTruthy();
  });

  it("hides assets from picker state without deleting them", async () => {
    const onItemsChange = vi.fn();
    const onSelectionChange = vi.fn();

    render(
      <MediaLibraryPickerGrid
        items={[asset({ id: "music", fileName: "Music Bingo.png", tags: ["music bingo"] })]}
        selectedIds={["music"]}
        onSelectionChange={onSelectionChange}
        onItemsChange={onItemsChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide Music Bingo.png" }));

    await waitFor(() => {
      expect(hideMediaAssetsMock).toHaveBeenCalledWith({ assetIds: ["music"] });
    });
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });
});
