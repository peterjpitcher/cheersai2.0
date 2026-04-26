"use client";

import { useState } from "react";
import {
  BANNER_POSITIONS,
  BANNER_COLOR_SCHEMES,
  COLOUR_MAP,
  type BannerDefaults,
  type BannerPosition,
  type BannerColorScheme,
} from "@/lib/scheduling/banner-config";

interface BannerDefaultsPickerProps {
  value: BannerDefaults;
  onChange: (value: BannerDefaults) => void;
}

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top", bottom: "Bottom", left: "Left", right: "Right",
};

const PRESET_SCHEMES = BANNER_COLOR_SCHEMES.filter((s) => s !== "custom") as Exclude<BannerColorScheme, "custom">[];

export function BannerDefaultsPicker({ value, onChange }: BannerDefaultsPickerProps): React.ReactElement {
  const [customBg, setCustomBg] = useState(value.customBg ?? "#a57626");
  const [customText, setCustomText] = useState(value.customText ?? "#005131");
  const isCustom = value.colorScheme === "custom";

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
          {PRESET_SCHEMES.map((scheme) => {
            const c = COLOUR_MAP[scheme];
            return (
              <button
                key={scheme}
                type="button"
                className={`flex h-7 w-14 items-center justify-center rounded border text-[10px] font-bold ${
                  value.colorScheme === scheme ? "ring-2 ring-primary" : ""
                }`}
                style={{ backgroundColor: c.bg, color: c.text }}
                onClick={() => onChange({ ...value, colorScheme: scheme, customBg: undefined, customText: undefined })}
              >
                Aa
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Custom colours</label>
        <div className="mt-1 flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">BG</span>
            <input
              type="color"
              value={isCustom ? (value.customBg ?? customBg) : customBg}
              className="h-7 w-10 cursor-pointer rounded border p-0"
              onChange={(e) => {
                setCustomBg(e.target.value);
                onChange({ ...value, colorScheme: "custom", customBg: e.target.value, customText: isCustom ? (value.customText ?? customText) : customText });
              }}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Text</span>
            <input
              type="color"
              value={isCustom ? (value.customText ?? customText) : customText}
              className="h-7 w-10 cursor-pointer rounded border p-0"
              onChange={(e) => {
                setCustomText(e.target.value);
                onChange({ ...value, colorScheme: "custom", customBg: isCustom ? (value.customBg ?? customBg) : customBg, customText: e.target.value });
              }}
            />
          </label>
          {isCustom && (
            <div
              className="flex h-7 w-16 items-center justify-center rounded border text-[10px] font-bold ring-2 ring-primary"
              style={{ backgroundColor: value.customBg ?? customBg, color: value.customText ?? customText }}
            >
              Aa
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
