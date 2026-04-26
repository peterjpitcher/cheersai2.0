"use client";

import {
  BANNER_POSITIONS,
  BANNER_COLOURS,
  BANNER_COLOUR_HEX,
  type BannerDefaults,
  type BannerPosition,
  type BannerColourId,
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
        <label className="text-sm font-medium">Background Colour</label>
        <div className="mt-1 flex gap-1">
          {BANNER_COLOURS.map((colour) => (
            <button
              key={colour.id}
              type="button"
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                value.bgColour === colour.id ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
              style={{
                backgroundColor: colour.hex,
                borderColor: colour.id === "white" ? "#d1d5db" : colour.hex,
              }}
              title={colour.label}
              onClick={() => onChange({ ...value, bgColour: colour.id as BannerColourId })}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Text Colour</label>
        <div className="mt-1 flex gap-1">
          {BANNER_COLOURS.map((colour) => (
            <button
              key={colour.id}
              type="button"
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                value.textColour === colour.id ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
              style={{
                backgroundColor: colour.hex,
                borderColor: colour.id === "white" ? "#d1d5db" : colour.hex,
              }}
              title={colour.label}
              onClick={() => onChange({ ...value, textColour: colour.id as BannerColourId })}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Preview</span>
        <div
          className="flex h-6 items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: BANNER_COLOUR_HEX[value.bgColour],
            color: BANNER_COLOUR_HEX[value.textColour],
          }}
        >
          SAMPLE TEXT
        </div>
      </div>
    </div>
  );
}
