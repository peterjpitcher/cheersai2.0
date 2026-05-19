"use client";

import { useId } from "react";

import {
  BANNER_POSITIONS,
  BANNER_COLOURS,
  BANNER_COLOUR_HEX,
  sanitiseCustomMessage,
  type BannerDefaults,
  type BannerPosition,
  type BannerColourId,
} from "@/lib/scheduling/banner-config";

interface BannerDefaultsPickerProps {
  value: BannerDefaults;
  onChange: (value: BannerDefaults) => void;
  autoLabelPreview?: string;
}

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top", bottom: "Bottom", left: "Left", right: "Right",
};

function normaliseBannerTextDraft(value: string): string {
  return Array.from(value.replace(/[\n\r\t\x00-\x1f\x7f]/g, "").toUpperCase())
    .slice(0, 20)
    .join("");
}

export function BannerDefaultsPicker({
  value,
  onChange,
  autoLabelPreview = "TODAY",
}: BannerDefaultsPickerProps): React.ReactElement {
  const textInputId = useId();
  const textDraft = value.customMessage ?? "";
  const previewText = sanitiseCustomMessage(textDraft) ?? autoLabelPreview;

  function updateCustomMessage(nextValue: string): void {
    const nextDraft = normaliseBannerTextDraft(nextValue);
    onChange({ ...value, customMessage: nextDraft || undefined });
  }

  function commitCustomMessage(): void {
    onChange({ ...value, customMessage: sanitiseCustomMessage(textDraft) });
  }

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
        <label htmlFor={textInputId} className="text-sm font-medium">Overlay Text</label>
        <div className="mt-1 flex max-w-md items-center gap-2">
          <input
            id={textInputId}
            type="text"
            value={textDraft}
            maxLength={20}
            placeholder={autoLabelPreview}
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold uppercase text-slate-900 shadow-sm outline-none"
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-status-posted-fg)"; e.currentTarget.style.boxShadow = "0 0 0 2px color-mix(in srgb, var(--c-status-posted-fg) 30%, transparent)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; commitCustomMessage(); }}
            onChange={(event) => updateCustomMessage(event.target.value)}
          />
          <span className="w-11 text-right text-xs text-muted-foreground">
            {Array.from(textDraft).length}/20
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Leave blank for automatic countdown.</p>
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
          className="flex h-6 max-w-full items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: BANNER_COLOUR_HEX[value.bgColour],
            color: BANNER_COLOUR_HEX[value.textColour],
          }}
        >
          <span className="max-w-[14rem] truncate">{previewText}</span>
        </div>
      </div>
    </div>
  );
}
