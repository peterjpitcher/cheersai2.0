"use client";

import { useState, useTransition } from "react";
import {
  BANNER_POSITIONS,
  BANNER_COLOR_SCHEMES,
  COLOUR_MAP,
  sanitiseCustomMessage,
  BANNER_EDITABLE_STATUSES,
  type BannerConfig,
  type BannerPosition,
  type BannerColorScheme,
} from "@/lib/scheduling/banner-config";
import { updatePlannerBannerConfig } from "@/app/(app)/planner/actions";

interface BannerControlsProps {
  contentItemId: string;
  status: string;
  bannerConfig: BannerConfig | null;
  autoLabel: string | null;
  onUpdate?: (config: BannerConfig) => void;
}

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

/** Preset schemes only — excludes "custom" from the swatch grid */
const PRESET_SCHEMES = BANNER_COLOR_SCHEMES.filter((s) => s !== "custom") as Exclude<BannerColorScheme, "custom">[];

export function BannerControls({
  contentItemId,
  status,
  bannerConfig,
  autoLabel,
  onUpdate,
}: BannerControlsProps): React.ReactElement {
  const isEditable = (BANNER_EDITABLE_STATUSES as readonly string[]).includes(status);
  const [isPending, startTransition] = useTransition();

  const config = bannerConfig ?? {
    schemaVersion: 1 as const,
    enabled: false,
    position: "top" as const,
    colorScheme: "gold-green" as const,
  };

  const [customMsg, setCustomMsg] = useState(config.customMessage ?? "");
  const [customBg, setCustomBg] = useState(config.customBg ?? "#a57626");
  const [customText, setCustomText] = useState(config.customText ?? "#005131");

  function save(partial: Partial<BannerConfig>): void {
    if (!isEditable) return;
    const updated: BannerConfig = { ...config, ...partial, schemaVersion: 1 };
    startTransition(async () => {
      await updatePlannerBannerConfig(contentItemId, updated);
      onUpdate?.(updated);
    });
  }

  const graphemeCount = customMsg.length;
  const isCustomScheme = config.colorScheme === "custom";

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Proximity Banner</span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={!isEditable || isPending}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          <span className="text-xs text-muted-foreground">
            {config.enabled ? "On" : "Off"}
          </span>
        </label>
      </div>

      {config.enabled && (
        <>
          {/* Position picker */}
          <div>
            <span className="text-xs text-muted-foreground">Position</span>
            <div className="mt-1 flex gap-1">
              {BANNER_POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  disabled={!isEditable || isPending}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    config.position === pos
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                  onClick={() => save({ position: pos })}
                >
                  {POSITION_LABELS[pos]}
                </button>
              ))}
            </div>
          </div>

          {/* Colour presets */}
          <div>
            <span className="text-xs text-muted-foreground">Colour presets</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {PRESET_SCHEMES.map((scheme) => {
                const c = COLOUR_MAP[scheme];
                return (
                  <button
                    key={scheme}
                    type="button"
                    disabled={!isEditable || isPending}
                    className={`flex h-7 w-14 items-center justify-center rounded border text-[10px] font-bold ${
                      config.colorScheme === scheme ? "ring-2 ring-primary" : ""
                    }`}
                    style={{ backgroundColor: c.bg, color: c.text }}
                    onClick={() => save({ colorScheme: scheme, customBg: undefined, customText: undefined })}
                  >
                    Aa
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom colour pickers */}
          <div>
            <span className="text-xs text-muted-foreground">Custom colours</span>
            <div className="mt-1 flex items-center gap-3">
              <label className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">BG</span>
                <input
                  type="color"
                  value={isCustomScheme ? (config.customBg ?? customBg) : customBg}
                  disabled={!isEditable || isPending}
                  className="h-7 w-10 cursor-pointer rounded border p-0"
                  onChange={(e) => {
                    setCustomBg(e.target.value);
                    save({ colorScheme: "custom", customBg: e.target.value, customText: isCustomScheme ? (config.customText ?? customText) : customText });
                  }}
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Text</span>
                <input
                  type="color"
                  value={isCustomScheme ? (config.customText ?? customText) : customText}
                  disabled={!isEditable || isPending}
                  className="h-7 w-10 cursor-pointer rounded border p-0"
                  onChange={(e) => {
                    setCustomText(e.target.value);
                    save({ colorScheme: "custom", customBg: isCustomScheme ? (config.customBg ?? customBg) : customBg, customText: e.target.value });
                  }}
                />
              </label>
              {isCustomScheme && (
                <div
                  className="flex h-7 w-16 items-center justify-center rounded border text-[10px] font-bold ring-2 ring-primary"
                  style={{ backgroundColor: config.customBg ?? customBg, color: config.customText ?? customText }}
                >
                  Aa
                </div>
              )}
            </div>
          </div>

          {/* Custom message */}
          <div>
            <span className="text-xs text-muted-foreground">
              Custom message (optional)
            </span>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                maxLength={20}
                placeholder={autoLabel ?? "Auto-generated"}
                value={customMsg}
                disabled={!isEditable || isPending}
                className="flex-1 rounded border px-2 py-1 text-sm uppercase"
                onChange={(e) => setCustomMsg(e.target.value)}
                onBlur={() => {
                  const sanitised = sanitiseCustomMessage(customMsg);
                  setCustomMsg(sanitised ?? "");
                  save({ customMessage: sanitised });
                }}
              />
              <span className="self-center text-xs text-muted-foreground">
                {graphemeCount}/20
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
