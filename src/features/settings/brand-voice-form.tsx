"use client";

import { useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { BrandProfile } from "@/lib/settings/data";
import {
  BrandProfileFormValues,
  brandProfileFormSchema,
} from "@/features/settings/schema";
import { updateBrandProfile } from "@/app/(app)/settings/actions";

interface BrandVoiceFormProps {
  data: BrandProfile;
}

const RANGE_STOPS = [0, 0.25, 0.5, 0.75, 1];

export function BrandVoiceForm({ data }: BrandVoiceFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<BrandProfileFormValues>({
    resolver: zodResolver(brandProfileFormSchema),
    defaultValues: {
      toneFormal: data.toneFormal,
      tonePlayful: data.tonePlayful,
      keyPhrases: data.keyPhrases,
      bannedTopics: data.bannedTopics,
      defaultHashtags: data.defaultHashtags,
      defaultEmojis: data.defaultEmojis,
      instagramSignature: data.instagramSignature,
      facebookSignature: data.facebookSignature,
      gbpCta: data.gbpCta,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      await updateBrandProfile(values);
    });
  });

  return (
    <form className="space-y-8" onSubmit={onSubmit} id="brand-voice">
      <fieldset className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">Tone sliders</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Formal ↔ Casual
            </label>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-slate-500">Formal</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-slate-200"
                {...form.register("toneFormal", {
                  valueAsNumber: true,
                })}
              />
              <span className="text-xs text-slate-500">Casual</span>
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-slate-400">
              {RANGE_STOPS.map((stop) => (
                <span key={stop}>{stop}</span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Serious ↔ Playful
            </label>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-slate-500">Serious</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-slate-200"
                {...form.register("tonePlayful", {
                  valueAsNumber: true,
                })}
              />
              <span className="text-xs text-slate-500">Playful</span>
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-slate-400">
              {RANGE_STOPS.map((stop) => (
                <span key={stop}>{stop}</span>
              ))}
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">Language controls</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Key phrases</label>
            <p className="text-xs text-slate-500">
              Comma separated – we’ll weave these into AI prompts.
            </p>
            <Controller
              control={form.control}
              name="keyPhrases"
              render={({ field }) => (
                <textarea
                  className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                  value={field.value.join(", ")}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Topics to avoid</label>
            <p className="text-xs text-slate-500">Comma separated list.</p>
            <Controller
              control={form.control}
              name="bannedTopics"
              render={({ field }) => (
                <textarea
                  className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                  value={field.value.join(", ")}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Default hashtags</label>
            <Controller
              control={form.control}
              name="defaultHashtags"
              render={({ field }) => (
                <textarea
                  className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                  value={field.value.join("\n")}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value
                        .split(/\r?\n/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Default emojis</label>
            <Controller
              control={form.control}
              name="defaultEmojis"
              render={({ field }) => (
                <textarea
                  className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                  value={field.value.join(" ")}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value
                        .split(/\s+/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">
          Platform signatures & CTA
        </legend>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="text-sm font-medium text-slate-700">
              Instagram signature
            </label>
            <textarea
              className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("instagramSignature")}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">
              Facebook signature
            </label>
            <textarea
              className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("facebookSignature")}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">
              GBP default CTA
            </label>
            <select
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("gbpCta")}
            >
              <option value="LEARN_MORE">Learn more</option>
              <option value="BOOK">Book</option>
              <option value="CALL">Call</option>
              <option value="REDEEM">Redeem</option>
            </select>
          </div>
        </div>
      </fieldset>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Saving…" : "Save brand voice"}
        </button>
      </div>
    </form>
  );
}
