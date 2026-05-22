import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type MediaPlacement = "feed" | "story";
export type MediaFrameSize = "calendar" | "thumb" | "preview" | "full" | "fluid";

const ASPECT_CLASS: Record<MediaPlacement, string> = {
  feed: "aspect-square",
  story: "aspect-[9/16]",
};

const SIZE_CLASS: Record<MediaFrameSize, Record<MediaPlacement, string>> = {
  calendar: {
    feed: "w-[118px] max-w-full",
    story: "w-[78px] max-w-full sm:w-[92px]",
  },
  thumb: {
    feed: "w-20 max-w-full",
    story: "w-14 max-w-full",
  },
  preview: {
    feed: "w-full max-w-[360px]",
    story: "w-full max-w-[220px]",
  },
  full: {
    feed: "w-full max-w-[640px]",
    story: "w-full max-w-[360px]",
  },
  fluid: {
    feed: "w-full",
    story: "w-full",
  },
};

export function resolveMediaPlacement(input?: {
  placement?: string | null;
  contentType?: string | null;
} | null): MediaPlacement {
  if (input?.placement === "story" || input?.contentType === "story") {
    return "story";
  }
  return "feed";
}

export function getMediaAspectClass(placement: MediaPlacement) {
  return ASPECT_CLASS[placement];
}

export function MediaFrame({
  placement = "feed",
  size = "preview",
  className,
  children,
}: {
  placement?: MediaPlacement;
  size?: MediaFrameSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-media-placement={placement}
      data-media-size={size}
      className={cn(
        "relative mx-auto overflow-hidden rounded-lg border bg-[var(--c-paper-2)]",
        ASPECT_CLASS[placement],
        SIZE_CLASS[size][placement],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MediaFrameImage({
  src,
  alt,
  placement = "feed",
  size = "preview",
  className,
  imageClassName,
  sizes = "(max-width: 768px) 100vw, 320px",
  priority,
  unoptimized,
}: {
  src: string;
  alt: string;
  placement?: MediaPlacement;
  size?: MediaFrameSize;
  className?: string;
  imageClassName?: string;
  sizes?: string;
  priority?: boolean;
  unoptimized?: boolean;
}) {
  return (
    <MediaFrame placement={placement} size={size} className={className}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={unoptimized}
        className={cn("h-full w-full object-contain", imageClassName)}
      />
    </MediaFrame>
  );
}

export function MediaFrameRawImage({
  src,
  alt,
  placement = "feed",
  size = "preview",
  className,
  imageClassName,
}: {
  src: string;
  alt: string;
  placement?: MediaPlacement;
  size?: MediaFrameSize;
  className?: string;
  imageClassName?: string;
}) {
  return (
    <MediaFrame placement={placement} size={size} className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        className={cn("h-full w-full object-contain", imageClassName)}
      />
    </MediaFrame>
  );
}

export function MediaFrameVideo({
  src,
  placement = "feed",
  size = "preview",
  className,
  videoClassName,
  controls = false,
}: {
  src: string;
  placement?: MediaPlacement;
  size?: MediaFrameSize;
  className?: string;
  videoClassName?: string;
  controls?: boolean;
}) {
  return (
    <MediaFrame placement={placement} size={size} className={className}>
      <video
        src={src}
        className={cn("h-full w-full object-contain", videoClassName)}
        preload="metadata"
        muted
        playsInline
        controls={controls}
      />
    </MediaFrame>
  );
}
