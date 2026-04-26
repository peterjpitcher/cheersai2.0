"use client";

import {
  BANNER_POSITIONS,
  BANNER_COLOR_SCHEMES,
  COLOUR_MAP,
  type BannerDefaults,
  type BannerPosition,
} from "@/lib/scheduling/banner-config";

interface BannerDefaultsPickerProps {
  value: BannerDefaults;
  onChange: (value: BannerDefaults) => void;
}

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top", bottom: "Bottom", left: "Left", right: "Right",
};

export function BannerDefaultsPicker({ value, onChange }: BannerDefaultsPickerProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium">Banner Position</label>
        <div className="mt-1 flex gap-1">
          {BANNER_POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              className={`rounded px-3 py-1 text-xs font-medium ${
                value.position === pos ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
              onClick={() => onChange({ ...value, position: pos })}
            >
              {POSITION_LABELS[pos]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Banner Colour</label>
        <div className="mt-1 flex flex-wrap gap-1">
          {BANNER_COLOR_SCHEMES.map((scheme) => {
            const c = COLOUR_MAP[scheme];
            return (
              <button
                key={scheme}
                type="button"
                className={`flex h-7 w-14 items-center justify-center rounded border text-[10px] font-bold ${
                  value.colorScheme === scheme ? "ring-2 ring-primary" : ""
                }`}
                style={{ backgroundColor: c.bg, color: c.text }}
                onClick={() => onChange({ ...value, colorScheme: scheme })}
              >
                Aa
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
