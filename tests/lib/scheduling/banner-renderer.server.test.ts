import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { renderBannerForContent } from "@/lib/scheduling/banner-renderer.server";
import type { BannerPosition } from "@/lib/scheduling/banner-config";

function createSupabaseMock(position: BannerPosition, scheduledFor = "2026-04-28T06:30:00.000Z") {
  const updates: Array<Record<string, unknown>> = [];
  const uploads: Array<{ path: string; body: Buffer; options: Record<string, unknown> }> = [];

  const content = {
    id: "content-1",
    account_id: "account-1",
    placement: "feed",
    scheduled_for: scheduledFor,
    campaign_id: "campaign-1",
    prompt_context: {
      banner: {
        schemaVersion: 1,
        enabled: true,
        position,
        bgColour: "gold",
        textColour: "white",
      },
    },
    campaigns: {
      campaign_type: "event",
      metadata: {
        eventStart: "2026-04-29T18:00:00.000Z",
      },
    },
  };

  const variant = {
    id: "variant-1",
    content_item_id: "content-1",
    media_ids: ["media-1"],
    banner_state: "expected",
    bannered_media_path: null,
  };

  const media = {
    id: "media-1",
    storage_path: "originals/media-1.jpg",
    media_type: "image",
    derived_variants: null,
  };

  const query = (data: unknown) => ({
    select: () => query(data),
    eq: () => query(data),
    order: () => query(data),
    limit: () => query(data),
    maybeSingle: async () => ({ data, error: null }),
  });

  const makeSourceBlob = async () => {
    const buffer = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 3,
        background: "#123456",
      },
    }).jpeg().toBuffer();
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return new Blob([arrayBuffer]);
  };

  const supabase = {
    from: (table: string) => {
      if (table === "content_items") return query(content);
      if (table === "media_assets") return query(media);
      if (table === "content_variants") {
        return {
          ...query(variant),
          update: (payload: Record<string, unknown>) => ({
            eq: async () => {
              updates.push(payload);
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
    storage: {
      from: () => ({
        download: async () => ({ data: await makeSourceBlob(), error: null }),
        upload: async (path: string, body: Buffer, options: Record<string, unknown>) => {
          uploads.push({ path, body, options });
          return { error: null };
        },
      }),
    },
  };

  return { supabase, updates, uploads };
}

describe("renderBannerForContent", () => {
  it.each<BannerPosition>(["top", "bottom", "left", "right"])("renders and persists a %s banner", async (position) => {
    const { supabase, uploads, updates } = createSupabaseMock(position);

    const result = await renderBannerForContent({
      contentId: "content-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
    });

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;

    expect(result.storagePath).toBe("banners/content-1/variant-1.jpg");
    expect(result.label).toBe("TOMORROW NIGHT");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.options).toMatchObject({ contentType: "image/jpeg", upsert: true });
    expect(updates.at(-1)).toMatchObject({
      banner_state: "rendered",
      bannered_media_path: "banners/content-1/variant-1.jpg",
      banner_label: "TOMORROW NIGHT",
      banner_render_metadata: expect.objectContaining({ position }),
    });
  });

  it("marks banner as not applicable when no proximity label is due", async () => {
    const { supabase, uploads, updates } = createSupabaseMock("right", "2026-04-10T06:30:00.000Z");

    const result = await renderBannerForContent({
      contentId: "content-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
    });

    expect(result).toMatchObject({ status: "not_applicable", reason: "no_label_due" });
    expect(uploads).toHaveLength(0);
    expect(updates.at(-1)).toMatchObject({
      banner_state: "not_applicable",
      bannered_media_path: null,
    });
  });
});
