// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaPicker } from "@/features/create/media/media-picker";
import type { MediaAssetSummary } from "@/lib/library/data";

const UPLOADED_ASSET: MediaAssetSummary = {
  id: "new-asset",
  fileName: "event-poster.jpg",
  mediaType: "image",
  tags: [],
  uploadedAt: "2026-06-28T00:00:00.000Z",
  storagePath: "media/event-poster.jpg",
  processedStatus: "ready",
  derivedVariants: {},
  aspectClass: "square",
  previewUrl: "https://signed/event-poster.jpg",
  previewShape: "square",
};

// Mock the upload panel so the test can drive its onUploadComplete callback.
vi.mock("@/features/library/media-upload-panel", () => ({
  MediaUploadPanel: ({
    onUploadComplete,
  }: {
    onUploadComplete: (item: MediaAssetSummary) => void;
  }) => (
    <button type="button" onClick={() => onUploadComplete(UPLOADED_ASSET)}>
      simulate upload
    </button>
  ),
}));

// Auto-tagging hits a server action; stub it (only invoked when a campaignName is set).
vi.mock("@/app/(app)/library/actions", () => ({
  updateMediaAsset: vi.fn().mockResolvedValue({ success: true }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("<MediaPicker />", () => {
  // Regression: a freshly uploaded asset must be mirrored to the parent's library
  // state. Otherwise it lives only in this component and the create wizard's later
  // generate-step renders "No media attached" because it resolves selected ids
  // against the parent's (stale) libraryItems.
  it("propagates a freshly uploaded asset to the parent via onLibraryItemsChange", () => {
    const onMediaChange = vi.fn();
    const onLibraryItemsChange = vi.fn();

    render(
      <MediaPicker
        accountId="acc-1"
        selectedMediaIds={[]}
        onMediaChange={onMediaChange}
        libraryItems={[]}
        onLibraryItemsChange={onLibraryItemsChange}
      />,
    );

    fireEvent.click(screen.getByText("simulate upload"));

    // The new asset is added to the selection...
    expect(onMediaChange).toHaveBeenCalledWith(["new-asset"]);

    // ...and the library change is mirrored to the parent so downstream steps
    // can resolve the asset's preview.
    expect(onLibraryItemsChange).toHaveBeenCalledTimes(1);
    const action = onLibraryItemsChange.mock.calls[0][0] as (
      prev: MediaAssetSummary[],
    ) => MediaAssetSummary[];
    expect(typeof action).toBe("function");
    expect(action([]).map((item) => item.id)).toEqual(["new-asset"]);
  });

  it("does not call onLibraryItemsChange before any upload", () => {
    const onLibraryItemsChange = vi.fn();

    render(
      <MediaPicker
        accountId="acc-1"
        selectedMediaIds={[]}
        onMediaChange={vi.fn()}
        libraryItems={[]}
        onLibraryItemsChange={onLibraryItemsChange}
      />,
    );

    expect(onLibraryItemsChange).not.toHaveBeenCalled();
  });
});
