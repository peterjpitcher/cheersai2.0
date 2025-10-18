"use client";

type DerivativeKey = "square" | "story" | "landscape";

const VARIANT_DIMENSIONS: Record<DerivativeKey, { width: number; height: number }> = {
  square: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

export async function generateImageDerivatives(file: File) {
  const image = await loadImage(file);

  const derivatives: Partial<Record<DerivativeKey, Blob>> = {};

  for (const [key, { width, height }] of Object.entries(VARIANT_DIMENSIONS) as Array<
    [DerivativeKey, { width: number; height: number }]
  >) {
    derivatives[key] = await renderVariant(image, width, height);
  }

  return derivatives as Record<DerivativeKey, Blob>;
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
