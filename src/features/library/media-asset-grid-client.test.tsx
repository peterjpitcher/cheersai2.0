// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import type { MediaAssetSummary } from "@/lib/library/data";

const {
  deleteMediaAssetMock,
  fetchMediaAssetOriginalUrlMock,
  finaliseMediaUploadMock,
  generateImageDerivativesMock,
  hideMediaAssetsByTagMock,
  hideMediaAssetsMock,
  replaceMediaAssetEverywhereMock,
  requestMediaUploadMock,
  routerRefreshMock,
  updateMediaAssetMock,
} = vi.hoisted(() => ({
  deleteMediaAssetMock: vi.fn(),
  fetchMediaAssetOriginalUrlMock: vi.fn(),
  finaliseMediaUploadMock: vi.fn(),
  generateImageDerivativesMock: vi.fn(),
  hideMediaAssetsByTagMock: vi.fn(),
  hideMediaAssetsMock: vi.fn(),
  replaceMediaAssetEverywhereMock: vi.fn(),
  requestMediaUploadMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  updateMediaAssetMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("@/app/(app)/library/actions", () => ({
  bulkDeleteMediaAssets: vi.fn(),
  deleteMediaAsset: (...args: unknown[]) => deleteMediaAssetMock(...args),
  fetchMediaAssetOriginalUrl: (...args: unknown[]) => fetchMediaAssetOriginalUrlMock(...args),
  finaliseMediaUpload: (...args: unknown[]) => finaliseMediaUploadMock(...args),
  hideMediaAssets: (...args: unknown[]) => hideMediaAssetsMock(...args),
  hideMediaAssetsByTag: (...args: unknown[]) => hideMediaAssetsByTagMock(...args),
  replaceMediaAssetEverywhere: (...args: unknown[]) => replaceMediaAssetEverywhereMock(...args),
  requestMediaUpload: (...args: unknown[]) => requestMediaUploadMock(...args),
  updateMediaAsset: (...args: unknown[]) => updateMediaAssetMock(...args),
}));

vi.mock("@/lib/library/client-derivatives", () => ({
  generateImageDerivatives: (...args: unknown[]) => generateImageDerivativesMock(...args),
}));

import { MediaAssetGridClient } from "@/features/library/media-asset-grid-client";
import { ToastProvider } from "@/components/providers/toast-provider";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const replaceResult = {
  status: "replaced" as const,
  oldAssetId: "old-image",
  newAssetId: "new-image",
  counts: {
    variants: 0,
    attachments: 0,
    attachmentsDeduped: 0,
    campaigns: 0,
    linkInBioProfiles: 0,
    linkInBioTiles: 0,
    tournamentsSquare: 0,
    tournamentsStory: 0,
    adSets: 0,
    ads: 0,
  },
  hidden: true,
  updatedReferences: 0,
  remainingReferences: 0,
};

function asset(overrides: Partial<MediaAssetSummary> & Pick<MediaAssetSummary, "id" | "fileName">): MediaAssetSummary {
  return {
    mediaType: "image",
    tags: ["promo"],
    uploadedAt: "2026-07-01T09:00:00.000Z",
    sizeBytes: 1024,
    storagePath: `account-1/${overrides.id}.png`,
    processedStatus: "ready",
    processedAt: "2026-07-01T09:01:00.000Z",
    derivedVariants: { square: `derived/${overrides.id}/square.jpg`, story: `derived/${overrides.id}/story.jpg` },
    aspectClass: "square",
    previewUrl: `https://cdn.test/${overrides.id}.png`,
    previewShape: "square",
    ...overrides,
  };
}

describe("MediaAssetGridClient image replacement", () => {
  beforeEach(() => {
    hideMediaAssetsMock.mockResolvedValue({ hiddenIds: [], notFound: [] });
    hideMediaAssetsByTagMock.mockResolvedValue({ hiddenIds: [], notFound: [], tag: "promo", matchedCount: 0 });
    updateMediaAssetMock.mockResolvedValue(null);
    deleteMediaAssetMock.mockResolvedValue({ status: "deleted" });
    fetchMediaAssetOriginalUrlMock.mockResolvedValue(null);
    replaceMediaAssetEverywhereMock.mockResolvedValue(replaceResult);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows replace controls for images only", () => {
    renderWithToast(
      <MediaAssetGridClient
        assets={[
          asset({ id: "image-1", fileName: "Pub event.png", mediaType: "image" }),
          asset({ id: "video-1", fileName: "Promo clip.mp4", mediaType: "video" }),
        ]}
        availableTags={["promo"]}
      />,
    );

    expect(screen.getByRole("button", { name: "Replace image for Pub event.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace image for Promo clip.mp4" })).not.toBeInTheDocument();
  });

  it("uploads a replacement and swaps the visible asset", async () => {
    const replacement = asset({ id: "new-image", fileName: "New image.png" });
    requestMediaUploadMock.mockResolvedValue({
      assetId: replacement.id,
      uploadUrl: "https://upload.test/original",
      storagePath: replacement.storagePath,
      derivativeUploadUrls: {
        square: { uploadUrl: "https://upload.test/square", storagePath: "derived/new-image/square.jpg", contentType: "image/jpeg" },
        story: { uploadUrl: "https://upload.test/story", storagePath: "derived/new-image/story.jpg", contentType: "image/jpeg" },
        landscape: { uploadUrl: "https://upload.test/landscape", storagePath: "derived/new-image/landscape.jpg", contentType: "image/jpeg" },
      },
      mediaType: "image",
    });
    generateImageDerivativesMock.mockResolvedValue({
      aspectClass: "square",
      blobs: {
        square: new Blob(["square"], { type: "image/jpeg" }),
        story: new Blob(["story"], { type: "image/jpeg" }),
        landscape: new Blob(["landscape"], { type: "image/jpeg" }),
      },
    });
    finaliseMediaUploadMock.mockResolvedValue(replacement);

    renderWithToast(
      <MediaAssetGridClient
        assets={[asset({ id: "old-image", fileName: "Old image.png" })]}
        availableTags={["promo"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace image for Old image.png" }));
    fireEvent.change(screen.getByLabelText("Replacement image for Old image.png"), {
      target: { files: [new File(["new"], "new-image.png", { type: "image/png" })] },
    });

    await waitFor(() => {
      expect(replaceMediaAssetEverywhereMock).toHaveBeenCalledWith({
        oldAssetId: "old-image",
        newAssetId: "new-image",
      });
    });

    expect(screen.queryByText("Old image.png")).not.toBeInTheDocument();
    expect(screen.getByText("New image.png")).toBeInTheDocument();
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("keeps the old asset visible when the replacement found no exact references", async () => {
    const replacement = asset({ id: "new-image", fileName: "New image.png" });
    replaceMediaAssetEverywhereMock.mockResolvedValue({
      ...replaceResult,
      status: "replacement_has_no_references",
      hidden: false,
      updatedReferences: 0,
    });
    requestMediaUploadMock.mockResolvedValue({
      assetId: replacement.id,
      uploadUrl: "https://upload.test/original",
      storagePath: replacement.storagePath,
      derivativeUploadUrls: {},
      mediaType: "image",
    });
    generateImageDerivativesMock.mockResolvedValue({
      aspectClass: "square",
      blobs: {},
    });
    finaliseMediaUploadMock.mockResolvedValue(replacement);

    renderWithToast(
      <MediaAssetGridClient
        assets={[asset({ id: "old-image", fileName: "Old image.png" })]}
        availableTags={["promo"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace image for Old image.png" }));
    fireEvent.change(screen.getByLabelText("Replacement image for Old image.png"), {
      target: { files: [new File(["new"], "new-image.png", { type: "image/png" })] },
    });

    await waitFor(() => {
      expect(replaceMediaAssetEverywhereMock).toHaveBeenCalledWith({
        oldAssetId: "old-image",
        newAssetId: "new-image",
      });
    });

    expect(screen.getByText("Old image.png")).toBeInTheDocument();
    expect(screen.getByText("New image.png")).toBeInTheDocument();
  });
});
