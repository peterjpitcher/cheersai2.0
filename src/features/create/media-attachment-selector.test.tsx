// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaAssetInput } from "@/lib/create/schema";

import type { MediaAssetSummary } from "@/lib/library/data";

const { fetchMediaAssetPreviewUrlMock, pickerGridProps } = vi.hoisted(() => ({
  fetchMediaAssetPreviewUrlMock: vi.fn(),
  pickerGridProps: {
    current: null as {
      isAssetSelectable?: (asset: MediaAssetSummary) => boolean;
      onSelectionChange?: (ids: string[]) => void;
    } | null,
  },
}));

vi.mock("@/app/(app)/library/actions", () => ({
  fetchMediaAssetPreviewUrl: (...args: unknown[]) => fetchMediaAssetPreviewUrlMock(...args),
  finaliseMediaUpload: vi.fn(),
  requestMediaUpload: vi.fn(),
}));

vi.mock("@/lib/library/client-derivatives", () => ({
  generateImageDerivatives: vi.fn(),
}));

// Stub the picker grid so these tests focus on the selector's own behaviour.
// The stub records the props it receives so selectability and selection
// handling can be exercised without rendering the whole grid.
vi.mock("@/features/library/media-library-picker-grid", () => ({
  MediaLibraryPickerGrid: (props: Record<string, unknown>) => {
    pickerGridProps.current = props as NonNullable<typeof pickerGridProps.current>;
    return <div data-testid="picker-grid" />;
  },
}));

import {
  MediaAttachmentSelector,
  isStoryAssetSelectable,
} from "@/features/create/media-attachment-selector";

function asset(overrides: Partial<MediaAssetSummary> = {}): MediaAssetSummary {
  return {
    id: "m1",
    fileName: "a.jpg",
    mediaType: "image",
    tags: [],
    uploadedAt: "2026-07-01T00:00:00.000Z",
    storagePath: "orig/a.jpg",
    processedStatus: "ready",
    derivedVariants: { story: "derived/m1/story.jpg" },
    aspectClass: "square",
    previewShape: "square",
    ...overrides,
  };
}

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

describe("isStoryAssetSelectable", () => {
  it("accepts a ready image with a story derivative", () => {
    expect(isStoryAssetSelectable(asset())).toBe(true);
  });

  it("rejects a video", () => {
    expect(isStoryAssetSelectable(asset({ mediaType: "video" }))).toBe(false);
  });

  it("rejects an image with no story derivative", () => {
    expect(isStoryAssetSelectable(asset({ derivedVariants: {} }))).toBe(false);
  });

  it("rejects an image whose story derivative is an empty path", () => {
    expect(isStoryAssetSelectable(asset({ derivedVariants: { story: "" } }))).toBe(false);
  });

  it("rejects an image that is still processing", () => {
    expect(isStoryAssetSelectable(asset({ processedStatus: "processing" }))).toBe(false);
  });
});

describe("MediaAttachmentSelector story placement", () => {
  beforeEach(() => {
    pickerGridProps.current = null;
    fetchMediaAssetPreviewUrlMock.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  function renderSelector(
    placement: "feed" | "story" | undefined,
    onChange: (next: MediaAssetInput[]) => void = () => {},
  ) {
    render(
      <MediaAttachmentSelector
        assets={[asset({ id: "m1" }), asset({ id: "m2", fileName: "b.jpg" })]}
        selected={[]}
        onChange={onChange}
        label="Attachments"
        placement={placement}
      />,
    );
  }

  it("gates library selection on story publishability when placement is story", () => {
    renderSelector("story");
    const isSelectable = pickerGridProps.current?.isAssetSelectable;
    expect(isSelectable?.(asset())).toBe(true);
    expect(isSelectable?.(asset({ mediaType: "video" }))).toBe(false);
    expect(isSelectable?.(asset({ derivedVariants: {} }))).toBe(false);
  });

  it("still allows a ready video for feed placement", () => {
    renderSelector("feed");
    const isSelectable = pickerGridProps.current?.isAssetSelectable;
    expect(isSelectable?.(asset({ mediaType: "video", derivedVariants: {} }))).toBe(true);
  });

  it("keeps only the newest pick when placement is story", () => {
    const onChange = vi.fn();
    renderSelector("story", onChange);

    pickerGridProps.current?.onSelectionChange?.(["m1", "m2"]);

    expect(onChange).toHaveBeenCalledWith([
      { assetId: "m2", mediaType: "image", fileName: "b.jpg" },
    ]);
  });

  it("keeps every pick for feed placement", () => {
    const onChange = vi.fn();
    renderSelector("feed", onChange);

    pickerGridProps.current?.onSelectionChange?.(["m1", "m2"]);

    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(2);
  });
});
