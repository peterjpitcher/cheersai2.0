"use client";

import { resolveColours, type BannerColorScheme, type BannerPosition } from "@/lib/scheduling/banner-config";

interface BannerPreviewProps {
  label: string;
  position: BannerPosition;
  colorScheme: BannerColorScheme;
  customBg?: string;
  customText?: string;
  className?: string;
}

function repeatedLabel(label: string, count: number = 5): string {
  return Array(count).fill(label).join("  ·  ");
}

export function BannerPreview({ label, position, colorScheme, customBg, customText, className = "" }: BannerPreviewProps): React.ReactElement {
  const colours = resolveColours({ colorScheme, customBg, customText });
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
          ...(position === "top" ? { top: -2 } : { bottom: -2 }),
          fontSize: "0.8rem",
        }),
  };

  return (
    <div style={barStyle} className={className}>
      <span style={{ whiteSpace: "nowrap" }}>
        {isVertical ? repeatedLabel(label) : label}
      </span>
    </div>
  );
}
