"use client";

import { useEffect, useRef, useState } from "react";

import { renderBannerCanvas, type BannerCanvasInput } from "@/lib/scheduling/banner-canvas";
import type { BannerColourId, BannerPosition } from "@/lib/scheduling/banner-config";

interface BannerRenderedPreviewProps {
  imageUrl: string | null;
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
  labelText: string | null;
  className?: string;
}

const DEBOUNCE_MS = 300;

export function BannerRenderedPreview({
  imageUrl,
  position,
  bgColour,
  textColour,
  labelText,
  className,
}: BannerRenderedPreviewProps): React.ReactElement | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentBlobRef = useRef<string | null>(null);

  // Clean up a blob URL and clear the ref
  const revokeCurrent = (): void => {
    if (currentBlobRef.current) {
      URL.revokeObjectURL(currentBlobRef.current);
      currentBlobRef.current = null;
    }
  };

  useEffect(() => {
    // Nothing to render — reset state
    if (!imageUrl || !labelText) {
      revokeCurrent();
      setBlobUrl(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Clear any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setIsLoading(true);
    setError(null);

    debounceRef.current = setTimeout(() => {
      const input: BannerCanvasInput = {
        imageUrl,
        position,
        bgColour,
        textColour,
        labelText,
      };

      let cancelled = false;

      renderBannerCanvas(input)
        .then((blob) => {
          if (cancelled) return;
          revokeCurrent();
          const url = URL.createObjectURL(blob);
          currentBlobRef.current = url;
          setBlobUrl(url);
          setIsLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          revokeCurrent();
          setBlobUrl(null);
          setError(err instanceof Error ? err.message : "Banner rendering failed");
          setIsLoading(false);
        });

      // Cleanup for this specific render attempt
      return () => {
        cancelled = true;
      };
    }, DEBOUNCE_MS);

    // Cleanup on effect re-run or unmount
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [imageUrl, position, bgColour, textColour, labelText]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      revokeCurrent();
    };
  }, []);

  if (!imageUrl || !labelText) return null;

  if (isLoading) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-6">
          <p className="text-sm text-slate-500">Rendering banner&hellip;</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center rounded-md border border-dashed border-rose-300 bg-rose-50 p-6">
          <p className="text-sm text-rose-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!blobUrl) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={blobUrl}
      alt="Banner preview"
      className={className}
    />
  );
}
