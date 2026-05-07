"use client";

import { useState } from "react";
import { useToast } from "@/components/providers/toast-provider";
import { BANNER_EDITABLE_STATUSES } from "@/lib/scheduling/banner-config";
import {
  bannerConfigResolver,
  type AccountBannerDefaults,
  type BannerPosition,
  type PostBannerOverrides,
  type ResolvedConfig,
} from "@/lib/banner/config";
import { updatePlannerBannerConfig } from "@/app/(app)/planner/actions";

const BANNER_POSITIONS: readonly BannerPosition[] = [
  "top",
  "bottom",
  "left",
  "right",
];

const POSITION_LABELS: Record<BannerPosition, string> = {
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

interface BannerControlsProps {
  contentItemId: string;
  status: string;
  accountDefaults: AccountBannerDefaults;
  overrides: PostBannerOverrides;
  autoLabel: string | null;
  onUpdate?: (config: ResolvedConfig) => void;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

function sanitiseTextOverride(value: string): string | null {
  // Strip control characters, trim, uppercase. Returns null when empty.
  const cleaned = value
    .replace(/[\n\r\t\x00-\x1f\x7f]/g, "")
    .trim()
    .toUpperCase();
  return cleaned.length === 0 ? null : cleaned.slice(0, 20);
}

export function BannerControls({
  contentItemId,
  status,
  accountDefaults,
  overrides,
  autoLabel,
  onUpdate,
}: BannerControlsProps): React.ReactElement {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const isEditable = (BANNER_EDITABLE_STATUSES as readonly string[]).includes(status);
  const isLocked = saving || !isEditable;

  // Local override state mirrors what's in the database; resolves through the
  // shared resolver so the preview matches what BannerOverlay will render.
  const [localOverrides, setLocalOverrides] = useState<PostBannerOverrides>(overrides);
  const resolved = bannerConfigResolver(accountDefaults, localOverrides);
  const [textOverrideDraft, setTextOverrideDraft] = useState<string>(
    localOverrides.banner_text_override ?? "",
  );

  async function persist(next: PostBannerOverrides): Promise<void> {
    if (isLocked) return;
    setSaving(true);
    const previous = localOverrides;
    setLocalOverrides(next);
    onUpdate?.(bannerConfigResolver(accountDefaults, next));
    try {
      const result = await updatePlannerBannerConfig({
        contentItemId,
        enabled: next.banner_enabled,
        position: next.banner_position,
        bgColour: next.banner_bg,
        textColour: next.banner_text_colour,
        textOverride: next.banner_text_override,
      });
      if (result && "error" in result && result.error) {
        toast.error("Failed to save banner settings.");
        setLocalOverrides(previous);
        onUpdate?.(bannerConfigResolver(accountDefaults, previous));
      }
    } catch {
      toast.error("Failed to save banner settings.");
      setLocalOverrides(previous);
      onUpdate?.(bannerConfigResolver(accountDefaults, previous));
    } finally {
      setSaving(false);
    }
  }

  function setEnabled(value: boolean): void {
    void persist({ ...localOverrides, banner_enabled: value });
  }

  function setPosition(value: BannerPosition): void {
    void persist({ ...localOverrides, banner_position: value });
  }

  function setBgColour(value: string): void {
    if (!HEX.test(value)) return;
    void persist({ ...localOverrides, banner_bg: value });
  }

  function setTextColour(value: string): void {
    if (!HEX.test(value)) return;
    void persist({ ...localOverrides, banner_text_colour: value });
  }

  function commitTextOverride(): void {
    const sanitised = sanitiseTextOverride(textOverrideDraft);
    setTextOverrideDraft(sanitised ?? "");
    void persist({ ...localOverrides, banner_text_override: sanitised });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Proximity Banner</span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={resolved.enabled}
            disabled={isLocked}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="Toggle proximity banner"
          />
          <span className="text-xs text-muted-foreground">
            {resolved.enabled ? "On" : "Off"}
          </span>
        </label>
      </div>

      {resolved.enabled ? (
        <>
          {/* Position picker */}
          <div>
            <span className="text-xs text-muted-foreground">Position</span>
            <div className="mt-1 flex gap-1">
              {BANNER_POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  disabled={isLocked}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    resolved.position === pos
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                  onClick={() => setPosition(pos)}
                >
                  {POSITION_LABELS[pos]}
                </button>
              ))}
            </div>
          </div>

          {/* Background colour picker */}
          <div>
            <span className="text-xs text-muted-foreground">Background</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={resolved.bgColour}
                disabled={isLocked}
                onChange={(e) => setBgColour(e.target.value)}
                aria-label="Banner background colour"
                className="h-8 w-12 cursor-pointer rounded border"
              />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {resolved.bgColour}
              </span>
            </div>
          </div>

          {/* Text colour picker */}
          <div>
            <span className="text-xs text-muted-foreground">Text</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={resolved.textColour}
                disabled={isLocked}
                onChange={(e) => setTextColour(e.target.value)}
                aria-label="Banner text colour"
                className="h-8 w-12 cursor-pointer rounded border"
              />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {resolved.textColour}
              </span>
            </div>
          </div>

          {/* Preview swatch */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Preview</span>
            <div
              className="flex h-6 items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: resolved.bgColour,
                color: resolved.textColour,
              }}
            >
              {resolved.textOverride || autoLabel || "SAMPLE"}
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
                value={textOverrideDraft}
                disabled={isLocked}
                className="flex-1 rounded border px-2 py-1 text-sm uppercase"
                onChange={(e) => setTextOverrideDraft(e.target.value)}
                onBlur={commitTextOverride}
              />
              <span className="self-center text-xs text-muted-foreground">
                {textOverrideDraft.length}/20
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
