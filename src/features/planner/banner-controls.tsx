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
import { MAX_BANNER_TEXT_LENGTH, validateBannerText } from "@/lib/banner/text";

interface BannerControlsProps {
  contentItemId: string;
  status: string;
  accountDefaults: AccountBannerDefaults;
  overrides: PostBannerOverrides;
  /** @deprecated Overlays are opt-in per post; the automatic label is no longer shown. */
  autoLabel?: string | null;
  onUpdate?: (config: ResolvedConfig) => void;
}

export function BannerControls({
  contentItemId,
  status,
  accountDefaults,
  overrides,
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
    // Overlays are opt-in: the banner is enabled iff there is overlay text.
    // Writing an explicit boolean (never NULL) means a post can be turned OFF
    // and stays OFF on later edits, and can never be left enabled-but-blank.
    const overlayText = next.banner_text_override;
    const enabled = overlayText != null && overlayText.length > 0;
    const normalised: PostBannerOverrides = {
      ...next,
      banner_enabled: enabled,
      banner_position: FIXED_BANNER_POSITION,
      banner_bg: FIXED_BANNER_BG,
      banner_text_colour: FIXED_BANNER_TEXT,
      banner_text_override: enabled ? overlayText : null,
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
    const check = validateBannerText(textOverrideDraft);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    setTextOverrideDraft(check.value ?? "");
    void persist({ ...localOverrides, banner_text_override: check.value });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <span className="text-sm font-medium">Overlay</span>
        <p className="mt-1 text-xs text-muted-foreground">
          Add overlay text to switch it on for this post. Leave blank for no overlay.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Preview</span>
        {resolved.textOverride ? (
          <div
            className="flex h-6 items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: FIXED_BANNER_BG,
              color: FIXED_BANNER_TEXT,
            }}
          >
            {resolved.textOverride}
          </div>
        ) : (
          <span className="text-xs italic text-muted-foreground">No overlay</span>
        )}
      </div>

      <div>
        <span className="text-xs text-muted-foreground">
          Custom overlay text
        </span>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            aria-label="Custom overlay text"
            maxLength={MAX_BANNER_TEXT_LENGTH}
            placeholder="Add overlay text (optional)"
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
            Turn off
          </button>
          <span className="self-center text-xs text-muted-foreground">
            {textOverrideDraft.length}/{MAX_BANNER_TEXT_LENGTH}
          </span>
        </div>
      </div>
    </div>
  );
}
