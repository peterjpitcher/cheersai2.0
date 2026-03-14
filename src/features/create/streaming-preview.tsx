"use client";

interface StreamingPreviewProps {
  /** The platform keys to display, in display order. */
  platforms: string[];
  /** Accumulated streaming text per platform key. */
  streamingText: Record<string, string>;
  /** True while the stream is active (shows blinking cursor). */
  active: boolean;
}

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

/**
 * Renders a card per platform showing streaming text as it arrives from the
 * OpenAI SSE stream. Shows a blinking cursor on the currently active platform
 * and hides itself entirely when inactive with no text to display.
 */
export function StreamingPreview({ platforms, streamingText, active }: StreamingPreviewProps) {
  const hasAnyText = platforms.some((p) => (streamingText[p] ?? "").length > 0);

  if (!active && !hasAnyText) return null;

  // The last platform that has started streaming is considered "active"
  const activePlatform = active
    ? [...platforms].reverse().find((p) => (streamingText[p] ?? "").length > 0) ??
      (active ? platforms[0] : null)
    : null;

  return (
    <div className="space-y-3">
      {platforms.map((platform) => {
        const text = streamingText[platform] ?? "";
        const isActivePlatform = platform === activePlatform;
        const label = PLATFORM_DISPLAY_NAMES[platform] ?? platform;

        return (
          <div
            key={platform}
            className="rounded-xl border border-slate-200 bg-white p-4 space-y-2"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {label}
            </p>
            {text.length > 0 ? (
              <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                {text}
                {isActivePlatform && active ? (
                  <span
                    className="ml-0.5 inline-block h-[1em] w-[2px] bg-slate-800 align-middle animate-pulse"
                    aria-hidden="true"
                  />
                ) : null}
              </p>
            ) : (
              <p className="text-sm text-slate-400 italic">
                {active ? "Generating…" : "No content"}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
