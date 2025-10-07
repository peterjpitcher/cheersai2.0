"use client";

import { useState } from "react";
import type { FieldValues, Path, PathValue, UseFormReturn } from "react-hook-form";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";

interface AdvancedFields {
  toneAdjust: string;
  lengthPreference: string;
  includeHashtags: boolean;
  includeEmojis: boolean;
  ctaStyle: string;
}

interface AdvancedGenerationControlsProps<T extends AdvancedFields & FieldValues> {
  form: UseFormReturn<T>;
}

const toneOptions = [
  { value: "default", label: "Use brand tone" },
  { value: "more_formal", label: "More formal" },
  { value: "more_casual", label: "More casual" },
  { value: "more_serious", label: "More serious" },
  { value: "more_playful", label: "More playful" },
];

const lengthOptions = [
  { value: "standard", label: "Standard" },
  { value: "short", label: "Short & punchy" },
  { value: "detailed", label: "Detailed" },
];

const ctaOptions = [
  { value: "default", label: "Default" },
  { value: "direct", label: "Direct" },
  { value: "urgent", label: "Urgent" },
];

export function AdvancedGenerationControls<T extends AdvancedFields & FieldValues>({
  form,
}: AdvancedGenerationControlsProps<T>) {
  const [expanded, setExpanded] = useState(false);

  const includeHashtags = form.watch("includeHashtags" as Path<T>);
  const includeEmojis = form.watch("includeEmojis" as Path<T>);

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-2xl border border-brand-ambergold bg-brand-ambergold px-4 py-3 text-left text-sm font-semibold text-white shadow-sm transition hover:bg-brand-ambergold/90"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Fine-tune tone & format
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded ? (
        <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col text-sm text-slate-700">
              Tone adjustment
              <select
                className="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                {...form.register("toneAdjust" as Path<T>)}
              >
                {toneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm text-slate-700">
              Length
              <select
                className="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                {...form.register("lengthPreference" as Path<T>)}
              >
                {lengthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col text-sm text-slate-700">
            Call-to-action style
            <select
              className="mt-1 max-w-xs rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("ctaStyle" as Path<T>)}
            >
              {ctaOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-3">
            <TogglePill
              active={Boolean(includeHashtags)}
              label={includeHashtags ? "Hashtags on" : "Hashtags off"}
              description={includeHashtags ? "Include brand/default hashtags" : "No hashtags in output"}
              onClick={() =>
                form.setValue(
                  "includeHashtags" as Path<T>,
                  (!includeHashtags) as PathValue<T, Path<T>>,
                  {
                    shouldDirty: true,
                    shouldTouch: true,
                  },
                )
              }
            />
            <TogglePill
              active={Boolean(includeEmojis)}
              label={includeEmojis ? "Emojis on" : "Emojis off"}
              description={includeEmojis ? "Use sparingly" : "Avoid emojis"}
              onClick={() =>
                form.setValue(
                  "includeEmojis" as Path<T>,
                  (!includeEmojis) as PathValue<T, Path<T>>,
                  {
                    shouldDirty: true,
                    shouldTouch: true,
                  },
                )
              }
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface TogglePillProps {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}

function TogglePill({ active, label, description, onClick }: TogglePillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col rounded-2xl border border-brand-ambergold bg-brand-ambergold px-4 py-2 text-left text-xs text-white transition ${
        active ? "shadow-md ring-1 ring-brand-ambergold/30" : "opacity-80 hover:opacity-100"
      }`}
    >
      <span className="text-sm font-semibold text-white">{label}</span>
      <span className="text-white/80">{description}</span>
    </button>
  );
}
