"use client";

import { useTransition, useState } from "react";
import { useForm, useFieldArray, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { handleWeeklyCampaignSubmission } from "@/app/(app)/create/actions";
import {
  weeklyCampaignFormSchema,
  type WeeklyCampaignFormValues,
  type WeeklyCampaignInput,
} from "@/lib/create/schema";
import type { MediaAssetSummary } from "@/lib/library/data";
import { AdvancedGenerationControls } from "@/features/create/advanced-generation-controls";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";

const PLATFORM_LABELS: Record<WeeklyCampaignInput["platforms"][number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

const DAYS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

interface WeeklyCampaignFormProps {
  mediaLibrary: MediaAssetSummary[];
}

export function WeeklyCampaignForm({ mediaLibrary }: WeeklyCampaignFormProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(
    null,
  );

  const form = useForm<WeeklyCampaignFormValues>({
    resolver: zodResolver(weeklyCampaignFormSchema) as Resolver<WeeklyCampaignFormValues>,
    defaultValues: {
      name: "",
      description: "",
      dayOfWeek: new Date().getDay().toString(),
      startDate: new Date().toISOString().slice(0, 10),
      time: "19:00",
      weeksAhead: "4",
      prompt: "",
      platforms: ["facebook", "instagram"],
      heroMedia: [],
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      useManualSchedule: false,
      manualSlots: [],
    },
  });

  const selectedMedia = form.watch("heroMedia") ?? [];
  const manualEnabled = form.watch("useManualSchedule");

  const manualSlots = useFieldArray({
    control: form.control,
    name: "manualSlots",
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const response = await handleWeeklyCampaignSubmission(values);
      setResult({ status: response.status, scheduledFor: response.scheduledFor });
      form.reset({
        name: "",
        description: "",
        dayOfWeek: new Date().getDay().toString(),
        startDate: new Date().toISOString().slice(0, 10),
        time: "19:00",
        weeksAhead: "4",
        prompt: "",
        platforms: ["facebook", "instagram"],
        heroMedia: [],
        toneAdjust: "default",
        lengthPreference: "standard",
        includeHashtags: true,
        includeEmojis: true,
        ctaStyle: "default",
        useManualSchedule: false,
        manualSlots: [],
      });
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">Campaign name</label>
        <input
          type="text"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          placeholder="e.g. Thursday quiz night"
          {...form.register("name")}
        />
        {form.formState.errors.name ? (
          <p className="text-xs text-rose-500">{form.formState.errors.name.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">Description</label>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          rows={4}
          placeholder="Tell guests what happens each week, prizes, vibe, etc."
          {...form.register("description")}
        />
        {form.formState.errors.description ? (
          <p className="text-xs text-rose-500">{form.formState.errors.description.message}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-900">Day of week</label>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
            {...form.register("dayOfWeek")}
          >
            {DAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
          {form.formState.errors.dayOfWeek ? (
            <p className="text-xs text-rose-500">{form.formState.errors.dayOfWeek.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-900">Time</label>
          <input
            type="time"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
            {...form.register("time")}
          />
          {form.formState.errors.time ? (
            <p className="text-xs text-rose-500">{form.formState.errors.time.message}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-900">Start date</label>
          <input
            type="date"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
            {...form.register("startDate")}
          />
          {form.formState.errors.startDate ? (
            <p className="text-xs text-rose-500">{form.formState.errors.startDate.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-900">Weeks ahead to schedule</label>
          <input
            type="number"
            min={1}
            max={12}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
            {...form.register("weeksAhead")}
            disabled={manualEnabled}
          />
          {form.formState.errors.weeksAhead ? (
            <p className="text-xs text-rose-500">{form.formState.errors.weeksAhead.message}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">Extra prompt context</label>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          rows={3}
          placeholder="Optional: highlight seasonal themes, specials, etc."
          {...form.register("prompt")}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-900">Platforms</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PLATFORM_LABELS) as Array<WeeklyCampaignInput["platforms"][number]>).map(
            (platform) => {
              const selected = (form.watch("platforms") ?? []).includes(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatform(form, platform)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  {PLATFORM_LABELS[platform]}
                </button>
              );
            },
          )}
        </div>
        {form.formState.errors.platforms ? (
          <p className="text-xs text-rose-500">{form.formState.errors.platforms.message}</p>
        ) : null}
      </div>

      <MediaAttachmentSelector
        assets={mediaLibrary}
        selected={selectedMedia}
        onChange={(next) => form.setValue("heroMedia", next, { shouldDirty: true })}
        label="Hero media"
        description="Attach evergreen visuals to reuse across weekly slots."
      />
      {form.formState.errors.heroMedia ? (
        <p className="text-xs text-rose-500">{form.formState.errors.heroMedia.message as string}</p>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Manual schedule</p>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <input type="checkbox" className="h-4 w-4" {...form.register("useManualSchedule")} />
            Choose exact occurrences
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Use this when you don’t want the weekly cadence to auto-expand. We’ll create posts only for the
          slots you add.
        </p>
        {manualEnabled ? (
          <div className="space-y-3">
            {manualSlots.fields.map((field, index) => (
              <div key={field.id} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  type="date"
                  className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                  {...form.register(`manualSlots.${index}.date` as const)}
                />
                <input
                  type="time"
                  className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                  {...form.register(`manualSlots.${index}.time` as const)}
                />
                <button
                  type="button"
                  onClick={() => manualSlots.remove(index)}
                  className="self-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                manualSlots.append({
                  date: form.getValues("startDate") ?? new Date().toISOString().slice(0, 10),
                  time: form.getValues("time") ?? "19:00",
                })
              }
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-400"
            >
              Add occurrence
            </button>
            {form.formState.errors.manualSlots ? (
              <p className="text-xs text-rose-500">{form.formState.errors.manualSlots.message}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <AdvancedGenerationControls form={form} />

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending ? "Generating recurring plan…" : "Generate recurring plan"}
      </button>

      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <p className="font-semibold">Weekly campaign created</p>
          <p>
            Status: {result.status}. First occurrence scheduled {" "}
            {result.scheduledFor ? new Date(result.scheduledFor).toLocaleString() : "soon"}.
          </p>
        </div>
      ) : null}
    </form>
  );
}

function togglePlatform(
  form: UseFormReturn<WeeklyCampaignFormValues>,
  platform: WeeklyCampaignInput["platforms"][number],
) {
  const current = form.getValues("platforms") ?? [];
  if (current.includes(platform)) {
    form.setValue(
      "platforms",
      current.filter((item) => item !== platform),
    );
  } else {
    form.setValue("platforms", [...current, platform]);
  }
}
