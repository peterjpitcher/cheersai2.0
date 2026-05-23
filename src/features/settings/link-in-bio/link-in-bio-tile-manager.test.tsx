// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/components/providers/auth-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import { upsertLinkInBioTileSettings } from "@/app/(app)/settings/actions";
import { LinkInBioTileManager } from "@/features/settings/link-in-bio/link-in-bio-tile-manager";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { LinkInBioTile } from "@/lib/link-in-bio/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/app/(app)/settings/actions", () => ({
  removeLinkInBioTile: vi.fn(),
  reorderLinkInBioTilesSettings: vi.fn(),
  upsertLinkInBioTileSettings: vi.fn(),
}));

vi.mock("@/app/(app)/library/actions", () => ({
  finaliseMediaUpload: vi.fn(),
  requestMediaUpload: vi.fn(),
}));

vi.mock("@/lib/library/client-derivatives", () => ({
  generateImageDerivatives: vi.fn(),
}));

const baseTile: LinkInBioTile = {
  id: "tile-1",
  accountId: "account-1",
  title: "Private Hire",
  subtitle: "Parties and celebrations",
  ctaLabel: "Enquire Now",
  ctaUrl: "https://www.the-anchor.pub/private-hire",
  mediaAssetId: null,
  tileType: "link",
  embedData: null,
  position: 0,
  enabled: true,
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-01T10:00:00.000Z",
};

const imageAsset: MediaAssetSummary = {
  id: "asset-1",
  fileName: "Private Hire.jpg",
  mediaType: "image",
  tags: ["private hire"],
  uploadedAt: "2026-05-01T10:00:00.000Z",
  sizeBytes: 12345,
  storagePath: "account-1/asset-1/private-hire.jpg",
  processedStatus: "ready",
  processedAt: "2026-05-01T10:00:00.000Z",
  derivedVariants: {},
  aspectClass: "square",
  previewUrl: "https://example.test/private-hire.jpg",
  previewShape: "square",
};

const videoAsset: MediaAssetSummary = {
  ...imageAsset,
  id: "asset-video",
  fileName: "Event Clip.mp4",
  mediaType: "video",
  storagePath: "account-1/asset-video/event-clip.mp4",
  previewUrl: "https://example.test/event-clip.mp4",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderManager() {
  return render(
    <AuthProvider
      value={{
        id: "user-1",
        email: "owner@example.test",
        accountId: "account-1",
        businessName: "The Anchor",
        timezone: "Europe/London",
      }}
    >
      <ToastProvider>
        <LinkInBioTileManager tiles={[baseTile]} mediaAssets={[imageAsset, videoAsset]} />
      </ToastProvider>
    </AuthProvider>,
  );
}

describe("LinkInBioTileManager", () => {
  it("uses an upload-only image control instead of a media dropdown or library picker", async () => {
    const { container } = renderManager();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Tile image")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Upload" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Library" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    const mediaInput = container.querySelector<HTMLInputElement>('input[name="mediaAssetId"]');
    expect(mediaInput).not.toBeNull();
    expect(mediaInput?.value).toBe("");

    await waitFor(() => expect(upsertLinkInBioTileSettings).not.toHaveBeenCalled());
    expect(screen.getByText("Edit tile: Private Hire")).toBeInTheDocument();
    expect(screen.queryByText("Event Clip.mp4")).not.toBeInTheDocument();
  });
});
