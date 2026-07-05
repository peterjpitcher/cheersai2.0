// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaAssetInput } from "@/lib/create/schema";

const { fetchMediaAssetPreviewUrlMock } = vi.hoisted(() => ({
  fetchMediaAssetPreviewUrlMock: vi.fn(),
}));

vi.mock("@/app/(app)/library/actions", () => ({
  fetchMediaAssetPreviewUrl: (...args: unknown[]) => fetchMediaAssetPreviewUrlMock(...args),
  finaliseMediaUpload: vi.fn(),
  requestMediaUpload: vi.fn(),
}));

vi.mock("@/lib/library/client-derivatives", () => ({
  generateImageDerivatives: vi.fn(),
}));

// Stub the picker grid so this test focuses on the selected-chip rendering.
vi.mock("@/features/library/media-library-picker-grid", () => ({
  MediaLibraryPickerGrid: () => <div data-testid="picker-grid" />,
}));

import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";

describe("MediaAttachmentSelector — attached-but-hidden media", () => {
  beforeEach(() => {
    fetchMediaAssetPreviewUrlMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("fetches and renders a preview for a selected asset that is absent from the (hidden-filtered) library", async () => {
    fetchMediaAssetPreviewUrlMock.mockResolvedValue("https://cdn.test/hidden.png");

    const selected: MediaAssetInput[] = [
      { assetId: "hidden-1", mediaType: "image", fileName: "hidden.png" },
    ];

    render(
      <MediaAttachmentSelector
        assets={[]}
        selected={selected}
        onChange={() => {}}
        label="Attachments"
      />,
    );

    // The chip renders the attached media's own metadata even though the library is empty.
    expect(screen.getByText("hidden.png")).toBeInTheDocument();

    // The preview effect targets the selected asset that isn't in the library.
    await waitFor(() => {
      expect(fetchMediaAssetPreviewUrlMock).toHaveBeenCalledWith("hidden-1");
    });

    // Once resolved, the real thumbnail is shown for the hidden attached asset.
    await waitFor(() => {
      expect(screen.getByAltText("hidden.png")).toHaveAttribute("src", "https://cdn.test/hidden.png");
    });
  });
});
