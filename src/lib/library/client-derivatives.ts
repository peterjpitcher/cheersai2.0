"use client";

import { storyLayout } from "@/lib/media/story-layout";

type DerivativeKey = "square" | "story" | "landscape";

export type AspectClass = "square" | "story" | "landscape";

export interface DerivativeResult {
  blobs: Record<DerivativeKey, Blob>;
  aspectClass: AspectClass;
}

const VARIANT_DIMENSIONS: Record<DerivativeKey, { width: number; height: number }> = {
  square: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

export async function generateImageDerivatives(file: File): Promise<DerivativeResult> {
  const image = await loadImage(file);

  const derivatives: Partial<Record<DerivativeKey, Blob>> = {};

  for (const [key, { width, height }] of Object.entries(VARIANT_DIMENSIONS) as Array<
    [DerivativeKey, { width: number; height: number }]
  >) {
    derivatives[key] = key === "story"
      ? await renderStoryVariant(image, width, height)
      : await renderVariant(image, width, height);
  }

  const ratio = image.naturalWidth / image.naturalHeight;
  const aspectClass: AspectClass = ratio < 0.7 ? "story" : ratio > 1.3 ? "landscape" : "square";

  return { blobs: derivatives as Record<DerivativeKey, Blob>, aspectClass };
}

async function renderVariant(image: HTMLImageElement, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable for derivative generation");
  }

  context.clearRect(0, 0, width, height);

  const scale = Math.max(width / image.width, height / image.height);
  const renderWidth = image.width * scale;
  const renderHeight = image.height * scale;
  const offsetX = (width - renderWidth) / 2;
  const offsetY = (height - renderHeight) / 2;

  context.drawImage(image, offsetX, offsetY, renderWidth, renderHeight);

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
  if (!blob) {
    throw new Error("Failed to encode derivative image");
  }

  return blob;
}

/** The square-edge of the tiny canvas the background is blurred through. */
const BLUR_DOWNSCALE = 24;

/**
 * The story version: the whole image over a blurred, darkened copy of itself,
 * unless the image is already story-shaped (src/lib/media/story-layout.ts).
 * Cropping the middle cut the words off designed graphics.
 */
async function renderStoryVariant(image: HTMLImageElement, width: number, height: number): Promise<Blob> {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const layout = storyLayout(imageWidth, imageHeight, { width, height });
  if (layout.mode === "fill") {
    return renderVariant(image, width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(width / BLUR_DOWNSCALE));
  small.height = Math.max(1, Math.round(height / BLUR_DOWNSCALE));
  const smallContext = small.getContext("2d");
  if (!context || !smallContext) {
    throw new Error("Canvas context unavailable for derivative generation");
  }

  // Blurred by drawing the covering image tiny and scaling it back up, which
  // every browser supports (canvas filters are missing from some).
  const cover = Math.max(small.width / imageWidth, small.height / imageHeight);
  smallContext.drawImage(
    image,
    (small.width - imageWidth * cover) / 2,
    (small.height - imageHeight * cover) / 2,
    imageWidth * cover,
    imageHeight * cover,
  );
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(small, 0, 0, width, height);
  context.fillStyle = "rgba(0, 0, 0, 0.45)";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, layout.x, layout.y, layout.width, layout.height);

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
  if (!blob) {
    throw new Error("Failed to encode derivative image");
  }
  return blob;
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Canvas produced an empty blob"));
        }
      },
      type,
      quality,
    );
  });
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
