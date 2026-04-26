"use client";

import { COLOUR_MAP, type BannerColorScheme, type BannerPosition } from "@/lib/scheduling/banner-config";

interface BannerPreviewProps {
  label: string;
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  className?: string;
}

export function BannerPreview({ label, position, colorScheme, className = "" }: BannerPreviewProps): React.ReactElement {
  const colours = COLOUR_MAP[colorScheme];
  const isVertical = position === "left" || position === "right";

  const barStyle: React.CSSProperties = {
    position: "absolute",
    backgroundColor: colours.bg,
    color: colours.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    zIndex: 10,
    ...(isVertical
      ? {
          top: 0,
          bottom: 0,
          width: "8%",
          writingMode: "vertical-rl" as const,
          ...(position === "left" ? { left: 0, transform: "rotate(180deg)" } : { right: 0 }),
          fontSize: "0.55rem",
        }
      : {
          left: 0,
          right: 0,
          height: "8%",
          ...(position === "top" ? { top: 0 } : { bottom: 0 }),
          fontSize: "0.65rem",
        }),
  };

  return (
    <div style={barStyle} className={className}>
      {label}
    </div>
  );
}
