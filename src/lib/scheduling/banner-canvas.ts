// src/lib/scheduling/banner-canvas.ts
import { BANNER_COLOURS, type BannerPosition, type BannerColourId } from "./banner-config";

export const STRIP_PX = 80;
export const FONT_SIZE_MAX = 40;
export const FONT_SIZE_MIN = 20;
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const TEXT_MARGIN_PX = 16;
const MAX_SHORT_SIDE_PX = 1080;
const JPEG_QUALITY = 0.92;

export interface BannerCanvasInput {
  imageUrl: string;
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
  labelText: string;
}

function colourHex(id: BannerColourId): string {
  return BANNER_COLOURS.find((c) => c.id === id)?.hex ?? "#a57626";
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Image load failed: ${String(e)}`));
    img.src = url;
  });
}

function computeOutputDimensions(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  const shortSide = Math.min(naturalWidth, naturalHeight);
  if (shortSide <= MAX_SHORT_SIDE_PX) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = MAX_SHORT_SIDE_PX / shortSide;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

const SEPARATOR = "  ·  ";

/** Build a repeating string like "TONIGHT  ·  TONIGHT  ·  TONIGHT" wide enough to fill `targetWidth` */
function buildRepeatingLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  targetWidth: number,
): string {
  const segment = label + SEPARATOR;
  const segmentWidth = ctx.measureText(segment).width;
  if (segmentWidth <= 0) return label;
  const count = Math.ceil(targetWidth / segmentWidth) + 2; // +2 to overflow past both edges
  return Array(count).fill(label).join(SEPARATOR);
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  singleLabel: string,
  stripThickness: number,
): number {
  // Font size should fit within the strip thickness (height for horizontal, width for vertical)
  // Use 60% of strip as max font size, capped at FONT_SIZE_MAX
  const maxFromStrip = Math.floor(stripThickness * 0.6);
  const startSize = Math.min(FONT_SIZE_MAX, maxFromStrip);
  for (let size = startSize; size >= FONT_SIZE_MIN; size -= 2) {
    ctx.font = `800 ${size}px ${FONT_FAMILY}`;
    const measured = ctx.measureText(singleLabel);
    // Check the text height fits in the strip (approximation: font size ≈ height)
    if (size <= stripThickness - 8) {
      return size;
    }
  }
  return FONT_SIZE_MIN;
}

function drawHorizontalBanner(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  position: "top" | "bottom",
  bgHex: string,
  textHex: string,
  labelText: string,
): void {
  const y = position === "top" ? 0 : canvasHeight - STRIP_PX;

  // Draw strip
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, y, canvasWidth, STRIP_PX);

  // Fit font and build repeating text
  const fontSize = fitFontSize(ctx, labelText, STRIP_PX);
  ctx.font = `800 ${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = textHex;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const repeating = buildRepeatingLabel(ctx, labelText, canvasWidth);

  // Clip to strip region to keep text within the banner
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, canvasWidth, STRIP_PX);
  ctx.clip();

  // Draw from negative offset so text overflows past left edge
  const segmentWidth = ctx.measureText(labelText + SEPARATOR).width;
  const startX = -(segmentWidth / 2);
  ctx.fillText(repeating, startX, y + STRIP_PX / 2);

  ctx.restore();
}

function drawVerticalBanner(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  position: "left" | "right",
  bgHex: string,
  textHex: string,
  labelText: string,
): void {
  const x = position === "left" ? 0 : canvasWidth - STRIP_PX;

  // Draw strip
  ctx.fillStyle = bgHex;
  ctx.fillRect(x, 0, STRIP_PX, canvasHeight);

  // Fit font and build repeating text (for vertical, the "length" is canvasHeight)
  const fontSize = fitFontSize(ctx, labelText, STRIP_PX);

  ctx.save();
  ctx.font = `800 ${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = textHex;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const repeating = buildRepeatingLabel(ctx, labelText, canvasHeight);

  // Clip to strip region
  ctx.beginPath();
  ctx.rect(x, 0, STRIP_PX, canvasHeight);
  ctx.clip();

  // Rotate and draw
  if (position === "right") {
    ctx.translate(x + STRIP_PX / 2, canvasHeight / 2);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(x + STRIP_PX / 2, canvasHeight / 2);
    ctx.rotate(-Math.PI / 2);
  }

  const segmentWidth = ctx.measureText(labelText + SEPARATOR).width;
  const totalWidth = ctx.measureText(repeating).width;
  const startX = -(totalWidth / 2);
  ctx.fillText(repeating, startX, 0);

  ctx.restore();
}

export async function renderBannerCanvas(
  input: BannerCanvasInput,
): Promise<Blob> {
  const img = await loadImage(input.imageUrl);
  const { width, height } = computeOutputDimensions(
    img.naturalWidth,
    img.naturalHeight,
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context not available");
  }

  // Draw the source image scaled to output dimensions
  ctx.drawImage(img, 0, 0, width, height);

  const bgHex = colourHex(input.bgColour);
  const textHex = colourHex(input.textColour);

  if (input.position === "top" || input.position === "bottom") {
    drawHorizontalBanner(ctx, width, height, input.position, bgHex, textHex, input.labelText);
  } else {
    drawVerticalBanner(ctx, width, height, input.position, bgHex, textHex, input.labelText);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob returned null — canvas may be tainted by CORS"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
