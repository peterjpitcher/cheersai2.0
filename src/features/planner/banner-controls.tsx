"use client";

import { useState } from "react";
import { useToast } from "@/components/providers/toast-provider";
import { BANNER_EDITABLE_STATUSES } from "@/lib/scheduling/banner-config";
import {
  FIXED_BANNER_BG,
  FIXED_BANNER_POSITION,
  FIXED_BANNER_TEXT,
  bannerConfigResolver,
  type AccountBannerDefaults,
  type PostBannerOverrides,
  type ResolvedConfig,
} from "@/lib/banner/config";
import { updatePlannerBannerConfig } from "@/app/(app)/planner/actions";

interface BannerControlsProps {
  contentItemId: string;
  status: string;
  accountDefaults: AccountBannerDefaults;
  overrides: PostBannerOverrides;
  autoLabel: string | null;
  onUpdate?: (config: ResolvedConfig) => void;
}

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
    const normalised: PostBannerOverrides = {
      ...next,
      banner_enabled: true,
      banner_position: FIXED_BANNER_POSITION,
      banner_bg: FIXED_BANNER_BG,
      banner_text_colour: FIXED_BANNER_TEXT,
    };
    setSaving(true);
    const previous = localOverrides;
    setLocalOverrides(normalised);
    onUpdate?.(bannerConfigResolver(accountDefaults, normalised));
    try {
      const result = await updatePlannerBannerConfig({
        contentItemId,
        enabled: normalised.banner_enabled,
        position: normalised.banner_position,
        bgColour: normalised.banner_bg,
        textColour: normalised.banner_text_colour,
        textOverride: normalised.banner_text_override,
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

  function commitTextOverride(): void {
    const sanitised = sanitiseTextOverride(textOverrideDraft);
    setTextOverrideDraft(sanitised ?? "");
    void persist({ ...localOverrides, banner_text_override: sanitised });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <span className="text-sm font-medium">Overlay</span>
        <p className="mt-1 text-xs text-muted-foreground">
          Right-side gold banner. Leave blank to use the automatic label for this post.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Preview</span>
        <div
          className="flex h-6 items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: FIXED_BANNER_BG,
            color: FIXED_BANNER_TEXT,
          }}
        >
          {resolved.textOverride || autoLabel || "SAMPLE"}
        </div>
      </div>

      <div>
        <span className="text-xs text-muted-foreground">
          Custom overlay text
        </span>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            aria-label="Custom overlay text"
            maxLength={20}
            placeholder={autoLabel ?? "Auto-generated"}
            value={textOverrideDraft}
            disabled={isLocked}
            className="flex-1 rounded border px-2 py-1 text-sm uppercase"
            onChange={(e) => setTextOverrideDraft(e.target.value)}
            onBlur={commitTextOverride}
          />
          <button
            type="button"
            disabled={isLocked || textOverrideDraft.length === 0}
            onClick={() => {
              setTextOverrideDraft("");
              void persist({ ...localOverrides, banner_text_override: null });
            }}
            className="rounded border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Auto
          </button>
          <span className="self-center text-xs text-muted-foreground">
            {textOverrideDraft.length}/20
          </span>
        </div>
      </div>
    </div>
  );
}
