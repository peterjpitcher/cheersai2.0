"use client";

import { resolveColours, type BannerColourId, type BannerPosition } from "@/lib/scheduling/banner-config";

interface BannerOverlayPreviewProps {
  label: string;
  position: BannerPosition;
  bgColour: BannerColourId;
  textColour: BannerColourId;
  className?: string;
}

/** Repeat label with separators to fill the bar edge-to-edge */
function continuousLabel(label: string, count: number = 8): string {
  return Array(count).fill(label).join("  ·  ");
}

export function BannerOverlayPreview({ label, position, bgColour, textColour, className = "" }: BannerOverlayPreviewProps): React.ReactElement {
  const colours = resolveColours({ bgColour, textColour });
  const isVertical = position === "left" || position === "right";

  const barStyle: React.CSSProperties = {
    position: "absolute",
    backgroundColor: colours.bg,
    color: colours.text,
    display: "flex",
    alignItems: "center",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    zIndex: 10,
    overflow: "hidden",
    boxSizing: "border-box",
    ...(isVertical
      ? {
          top: -2,
          bottom: -2,
          width: "8%",
          minWidth: 28,
          justifyContent: "flex-start",
          writingMode: "vertical-rl" as const,
          ...(position === "left"
            ? { left: -2, transform: "rotate(180deg)" }
            : { right: -2 }),
          fontSize: "0.7rem",
        }
      : {
          left: -2,
          right: -2,
          height: "8%",
          minHeight: 24,
          justifyContent: "flex-start",
          ...(position === "top" ? { top: -2 } : { bottom: -2 }),
          fontSize: "0.8rem",
        }),
  };

  return (
    <div style={barStyle} className={className}>
      <span style={{ whiteSpace: "nowrap" }}>
        {continuousLabel(label)}
      </span>
    </div>
  );
}
