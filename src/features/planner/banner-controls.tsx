"use client";

import { useState } from "react";
import {
  BANNER_POSITIONS,
  BANNER_COLOURS,
  BANNER_COLOUR_HEX,
  sanitiseCustomMessage,
  BANNER_EDITABLE_STATUSES,
  type BannerConfig,
  type BannerPosition,
  type BannerColourId,
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

export function BannerControls({
  contentItemId,
  status,
  bannerConfig,
  autoLabel,
  onUpdate,
}: BannerControlsProps): React.ReactElement {
  const isEditable = (BANNER_EDITABLE_STATUSES as readonly string[]).includes(status);
  const isPending = false; // optimistic updates — no transition needed

  const config = bannerConfig ?? {
    schemaVersion: 1 as const,
    enabled: false,
    position: "top" as const,
    bgColour: "gold" as const,
    textColour: "green" as const,
  };

  const [customMsg, setCustomMsg] = useState(config.customMessage ?? "");

  function save(partial: Partial<BannerConfig>): void {
    if (!isEditable) return;
    const updated: BannerConfig = { ...config, ...partial, schemaVersion: 1 };
    // Optimistic: update preview immediately
    onUpdate?.(updated);
    // Persist in background — no transition wrapper so UI stays responsive
    updatePlannerBannerConfig(contentItemId, updated).catch(() => {});
  }

  const graphemeCount = customMsg.length;

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

          {/* Background colour */}
          <div>
            <span className="text-xs text-muted-foreground">Background</span>
            <div className="mt-1 flex gap-1">
              {BANNER_COLOURS.map((colour) => (
                <button
                  key={colour.id}
                  type="button"
                  disabled={!isEditable || isPending}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                    config.bgColour === colour.id ? "ring-2 ring-primary ring-offset-1" : ""
                  }`}
                  style={{
                    backgroundColor: colour.hex,
                    borderColor: colour.id === "white" ? "#d1d5db" : colour.hex,
                  }}
                  title={colour.label}
                  onClick={() => save({ bgColour: colour.id as BannerColourId })}
                />
              ))}
            </div>
          </div>

          {/* Text colour */}
          <div>
            <span className="text-xs text-muted-foreground">Text</span>
            <div className="mt-1 flex gap-1">
              {BANNER_COLOURS.map((colour) => (
                <button
                  key={colour.id}
                  type="button"
                  disabled={!isEditable || isPending}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                    config.textColour === colour.id ? "ring-2 ring-primary ring-offset-1" : ""
                  }`}
                  style={{
                    backgroundColor: colour.hex,
                    borderColor: colour.id === "white" ? "#d1d5db" : colour.hex,
                  }}
                  title={colour.label}
                  onClick={() => save({ textColour: colour.id as BannerColourId })}
                />
              ))}
            </div>
          </div>

          {/* Preview swatch */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Preview</span>
            <div
              className="flex h-6 items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: BANNER_COLOUR_HEX[config.bgColour],
                color: BANNER_COLOUR_HEX[config.textColour],
              }}
            >
              {customMsg || autoLabel || "SAMPLE"}
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
