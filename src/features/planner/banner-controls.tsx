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
  /**
   * The proximity label this post would print when no custom text is set
   * (TONIGHT, THIS FRIDAY, FRIDAY 17TH JULY). Shown in the preview so "on with
   * no text" reads as a real choice rather than an empty one.
   */
  autoLabel?: string | null;
  onUpdate?: (config: ResolvedConfig) => void;
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

  async function persist(next: PostBannerOverrides, enabled: boolean): Promise<void> {
    if (isLocked) return;
    // Always write an explicit boolean (never NULL) so a post that is turned OFF
    // stays off and cannot be re-enabled by the account default at publish time.
    // Enabled with no text is legitimate: the worker prints the computed
    // proximity label. Text is cleared when off so the two cannot disagree.
    const normalised: PostBannerOverrides = {
      ...next,
      banner_enabled: enabled,
      banner_position: FIXED_BANNER_POSITION,
      banner_bg: FIXED_BANNER_BG,
      banner_text_colour: FIXED_BANNER_TEXT,
      banner_text_override: enabled ? next.banner_text_override : null,
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
    // Typing text implies "on"; clearing it back to blank leaves the strip on
    // and falls back to the automatic label rather than silently switching off.
    void persist(
      { ...localOverrides, banner_text_override: check.value },
      resolved.enabled || check.value !== null,
    );
  }

  function toggleEnabled(next: boolean): void {
    void persist({ ...localOverrides, banner_text_override: textOverrideDraft || null }, next);
  }

  // What the strip will actually print: custom text wins, otherwise the
  // computed label. Mirrors BannerOverlay's own precedence.
  const previewText = resolved.enabled
    ? (resolved.textOverride && resolved.textOverride.length > 0
        ? resolved.textOverride
        : autoLabel ?? null)
    : null;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-medium">Overlay</span>
          <p className="mt-1 text-xs text-muted-foreground">
            Leave the text blank to print the automatic date label.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            role="switch"
            aria-label="Show overlay strip"
            checked={resolved.enabled}
            disabled={isLocked}
            className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          {resolved.enabled ? "On" : "Off"}
        </label>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Preview</span>
        {previewText ? (
          <div
            className="flex h-6 items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: FIXED_BANNER_BG,
              color: FIXED_BANNER_TEXT,
            }}
          >
            {previewText}
          </div>
        ) : (
          <span className="text-xs italic text-muted-foreground">
            {resolved.enabled ? "No label due for this date" : "No overlay"}
          </span>
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
            placeholder="Blank uses the automatic label"
            value={textOverrideDraft}
            disabled={isLocked || !resolved.enabled}
            className="flex-1 rounded border px-2 py-1 text-sm uppercase disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(e) => setTextOverrideDraft(e.target.value)}
            onBlur={commitTextOverride}
          />
          <button
            type="button"
            disabled={isLocked || textOverrideDraft.length === 0}
            onClick={() => {
              setTextOverrideDraft("");
              void persist({ ...localOverrides, banner_text_override: null }, resolved.enabled);
            }}
            className="rounded border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear text
          </button>
          <span className="self-center text-xs text-muted-foreground">
            {textOverrideDraft.length}/{MAX_BANNER_TEXT_LENGTH}
          </span>
        </div>
      </div>
    </div>
  );
}
