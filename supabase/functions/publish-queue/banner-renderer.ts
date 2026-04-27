// KEEP IN SYNC WITH: src/lib/scheduling/banner-config.ts (BANNER_COLOUR_HEX, BannerColourId)
// Deno Edge Function — uses FFmpeg WASM for image overlay.
// NOTE: FFmpeg is imported dynamically to avoid crashing the function at boot
// time — the WASM module requires APIs not available during Deno cold start.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lazy-loaded FFmpeg references
// deno-lint-ignore no-explicit-any
let _ffmpeg: any = null;
// deno-lint-ignore no-explicit-any
let _fetchFile: any = null;
let _ffmpegLoaded = false;

async function getFFmpeg() {
  if (!_ffmpeg) {
    const mod = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.6");
    _ffmpeg = mod.createFFmpeg({ log: false });
    _fetchFile = mod.fetchFile;
  }
  if (!_ffmpegLoaded) {
    await _ffmpeg.load();
    _ffmpegLoaded = true;
  }
  return { ffmpeg: _ffmpeg, fetchFile: _fetchFile };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BannerPosition = "top" | "bottom" | "left" | "right";

export type BannerColourId = "gold" | "green" | "black" | "white";

export interface BannerRenderInput {
  imageUrl: string; // signed URL of source image
  placement: "feed" | "story";
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
  labelText: string;
  contentItemId: string;
  variantId: string;
}

export interface BannerRenderOutput {
  tempStoragePath: string;
  signedUrl: string;
}

// ---------------------------------------------------------------------------
// Colour hex map (duplicated from src/lib/scheduling/banner-config.ts)
// ---------------------------------------------------------------------------

const BANNER_COLOUR_HEX: Record<BannerColourId, string> = {
  gold: "#a57626",
  green: "#005131",
  black: "#1a1a1a",
  white: "#ffffff",
};

// FFmpeg is now lazy-loaded via getFFmpeg() above.

// ---------------------------------------------------------------------------
// Banner strip dimensions
// ---------------------------------------------------------------------------

const STRIP_PX = 48;
const FONT_SIZE = 24;

// ---------------------------------------------------------------------------
// renderBanner
// ---------------------------------------------------------------------------

/**
 * Download the source image, overlay a coloured strip with text at the
 * specified edge, upload the result to Supabase Storage, and return a
 * signed URL.
 *
 * On failure the caller should fall back to publishing the original image.
 */
export async function renderBanner(
  input: BannerRenderInput,
  supabaseUrl: string,
  serviceRoleKey: string,
  mediaBucket: string,
): Promise<BannerRenderOutput> {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 1. Lazy-load FFmpeg + download source image
  const { ffmpeg, fetchFile: fetchFileFn } = await getFFmpeg();
  const sourceBuffer = await fetchFileFn(input.imageUrl);

  const inputName = `input_${input.variantId}`;
  const outputName = `output_${input.variantId}.jpg`;

  ffmpeg.FS("writeFile", inputName, sourceBuffer);

  // 2. Build FFmpeg filter string
  const bgHex = BANNER_COLOUR_HEX[input.bgColour] ?? BANNER_COLOUR_HEX.gold;
  const textHex = BANNER_COLOUR_HEX[input.textColour] ?? BANNER_COLOUR_HEX.white;
  const escapedText = input.labelText
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");

  const filter = buildFilter(input.position, bgHex, textHex, escapedText);

  // 3. Run FFmpeg
  await ffmpeg.run(
    "-i",
    inputName,
    "-vf",
    filter,
    "-q:v",
    "2",
    outputName,
  );

  const resultData = ffmpeg.FS("readFile", outputName);

  // Cleanup FFmpeg FS
  ffmpeg.FS("unlink", inputName);
  ffmpeg.FS("unlink", outputName);

  // 5. Upload to Supabase storage
  const storagePath = `banners/${input.contentItemId}/${input.variantId}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from(mediaBucket)
    .upload(storagePath, resultData.buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Banner upload failed: ${uploadError.message}`);
  }

  // 6. Create signed URL (600s TTL)
  const { data: signed, error: signedError } = await supabase.storage
    .from(mediaBucket)
    .createSignedUrl(storagePath, 600);

  if (signedError || !signed?.signedUrl) {
    throw new Error("Failed to create signed URL for banner");
  }

  return {
    tempStoragePath: storagePath,
    signedUrl: signed.signedUrl,
  };
}

// ---------------------------------------------------------------------------
// cleanupBannerTemp
// ---------------------------------------------------------------------------

/**
 * Delete the temporary banner file from storage after a successful publish.
 */
export async function cleanupBannerTemp(
  storagePath: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  mediaBucket: string,
): Promise<void> {
  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { error } = await supabase.storage
      .from(mediaBucket)
      .remove([storagePath]);

    if (error) {
      console.warn("[banner-renderer] cleanup failed", error);
    }
  } catch (err) {
    console.warn("[banner-renderer] cleanup error", err);
  }
}

// ---------------------------------------------------------------------------
// Filter builders
// ---------------------------------------------------------------------------

function buildFilter(
  position: BannerPosition,
  bgHex: string,
  textHex: string,
  escapedText: string,
): string {
  // NOTE: FFmpeg drawbox uses colour format without '#', drawtext fontcolor
  // accepts '#RRGGBB'. We pass bgHex with '#' stripped for drawbox and with
  // '#' for drawtext.
  const bgColour = bgHex.replace("#", "");

  switch (position) {
    case "top":
      return [
        `drawbox=x=0:y=0:w=iw:h=${STRIP_PX}:color=0x${bgColour}:t=fill`,
        `drawtext=text='${escapedText}':fontcolor=${textHex}:fontsize=${FONT_SIZE}:x=(w-text_w)/2:y=(${STRIP_PX}-text_h)/2`,
      ].join(",");

    case "bottom":
      return [
        `drawbox=x=0:y=ih-${STRIP_PX}:w=iw:h=${STRIP_PX}:color=0x${bgColour}:t=fill`,
        `drawtext=text='${escapedText}':fontcolor=${textHex}:fontsize=${FONT_SIZE}:x=(w-text_w)/2:y=ih-${STRIP_PX}+(${STRIP_PX}-text_h)/2`,
      ].join(",");

    case "left":
      // Vertical strip on the left — text drawn rotated would be complex;
      // for v1 we draw a vertical strip and place text horizontally centred.
      return [
        `drawbox=x=0:y=0:w=${STRIP_PX}:h=ih:color=0x${bgColour}:t=fill`,
        `drawtext=text='${escapedText}':fontcolor=${textHex}:fontsize=${FONT_SIZE}:x=(${STRIP_PX}-text_w)/2:y=(h-text_h)/2`,
      ].join(",");

    case "right":
      return [
        `drawbox=x=iw-${STRIP_PX}:y=0:w=${STRIP_PX}:h=ih:color=0x${bgColour}:t=fill`,
        `drawtext=text='${escapedText}':fontcolor=${textHex}:fontsize=${FONT_SIZE}:x=iw-${STRIP_PX}+(${STRIP_PX}-text_w)/2:y=(h-text_h)/2`,
      ].join(",");
  }
}
