// KEEP IN SYNC WITH: src/lib/scheduling/banner-config.ts (COLOUR_MAP, BannerColorScheme)
// Deno Edge Function — uses FFmpeg WASM for image overlay.

import { createFFmpeg, fetchFile } from "https://esm.sh/@ffmpeg/ffmpeg@0.12.6";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BannerPosition = "top" | "bottom" | "left" | "right";

export type BannerColorScheme =
  | "gold-green"
  | "green-gold"
  | "black-white"
  | "black-gold"
  | "black-green"
  | "white-black"
  | "white-green"
  | "white-gold";

export interface BannerRenderInput {
  imageUrl: string; // signed URL of source image
  placement: "feed" | "story";
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  labelText: string;
  contentItemId: string;
  variantId: string;
}

export interface BannerRenderOutput {
  tempStoragePath: string;
  signedUrl: string;
}

// ---------------------------------------------------------------------------
// Colour Map (duplicated from src/lib/scheduling/banner-config.ts)
// ---------------------------------------------------------------------------

export const COLOUR_MAP: Record<BannerColorScheme, { bg: string; text: string }> = {
  "gold-green":  { bg: "#a57626", text: "#005131" },
  "green-gold":  { bg: "#005131", text: "#a57626" },
  "black-white": { bg: "#1a1a1a", text: "#ffffff" },
  "black-gold":  { bg: "#1a1a1a", text: "#a57626" },
  "black-green": { bg: "#1a1a1a", text: "#005131" },
  "white-black": { bg: "#ffffff", text: "#1a1a1a" },
  "white-green": { bg: "#ffffff", text: "#005131" },
  "white-gold":  { bg: "#ffffff", text: "#a57626" },
};

// ---------------------------------------------------------------------------
// FFmpeg singleton (matches media-derivatives/index.ts pattern)
// ---------------------------------------------------------------------------

const ffmpeg = createFFmpeg({ log: false });
let ffmpegLoaded = false;

async function ensureFfmpeg(): Promise<void> {
  if (!ffmpegLoaded) {
    await ffmpeg.load();
    ffmpegLoaded = true;
  }
}

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

  // 1. Download source image
  const sourceBuffer = await fetchFile(input.imageUrl);

  // 2. Init FFmpeg
  await ensureFfmpeg();

  const inputName = `input_${input.variantId}`;
  const outputName = `output_${input.variantId}.jpg`;

  ffmpeg.FS("writeFile", inputName, sourceBuffer);

  // 3. Build FFmpeg filter string
  const colours = COLOUR_MAP[input.colorScheme] ?? COLOUR_MAP["gold-green"];
  const bgHex = colours.bg;
  const textHex = colours.text;
  const escapedText = input.labelText
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");

  const filter = buildFilter(input.position, bgHex, textHex, escapedText);

  // 4. Run FFmpeg
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
