"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useForm, useFieldArray, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DateTime } from "luxon";

import {
  fetchGeneratedContentDetails,
  handleWeeklyCampaignSubmission,
} from "@/app/(app)/create/actions";
import {
  weeklyCampaignFormSchema,
  type WeeklyCampaignFormValues,
  type WeeklyCampaignInput,
} from "@/lib/create/schema";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerOverview } from "@/lib/planner/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { AdvancedGenerationControls } from "@/features/create/advanced-generation-controls";
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";
import { ScheduleCalendar, type SelectedSlotDisplay, type SuggestedSlotDisplay } from "@/features/create/schedule/schedule-calendar";
import { buildWeeklySuggestions } from "@/features/create/schedule/suggestion-utils";
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
  plannerItems: PlannerOverview["items"];
  ownerTimezone: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
}

export function WeeklyCampaignForm({ mediaLibrary, plannerItems, ownerTimezone, onLibraryUpdate }: WeeklyCampaignFormProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progressActive, setProgressActive] = useState(false);
  const [progressValue, setProgressValue] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [generatedItems, setGeneratedItems] = useState<PlannerContentDetail[]>([]);
  const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaLibrary);

  useEffect(() => {
    setLibrary(mediaLibrary);
  }, [mediaLibrary]);

  useEffect(() => () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
  }, []);

  const handleLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>> = (updater) => {
    setLibrary((prev) => (typeof updater === "function" ? (updater as (value: MediaAssetSummary[]) => MediaAssetSummary[])(prev) : updater));
    if (onLibraryUpdate) {
      onLibraryUpdate(updater);
    }
  };

  const form = useForm<WeeklyCampaignFormValues>({
    resolver: zodResolver(weeklyCampaignFormSchema) as Resolver<WeeklyCampaignFormValues>,
    defaultValues: {
      name: "",
      description: "",
      dayOfWeek: new Date().getDay().toString(),
      startDate: new Date().toISOString().slice(0, 10),
      time: "07:00",
      weeksAhead: "4",
      prompt: "",
      platforms: ["facebook", "instagram"],
      heroMedia: [],
      ctaUrl: "",
      linkInBioUrl: "",
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      useManualSchedule: true,
      manualSlots: [],
    },
  });

  const selectedMedia = form.watch("heroMedia") ?? [];
  const dayOfWeekValue = Number(form.watch("dayOfWeek") ?? new Date().getDay());
  const startDateValue = form.watch("startDate");
  const timeValue = form.watch("time") ?? "07:00";
  const weeksAheadValue = form.watch("weeksAhead") ?? "4";

  const suggestions: SuggestedSlotDisplay[] = useMemo(
    () =>
      buildWeeklySuggestions({
        startDate: startDateValue,
        dayOfWeek: Number.isFinite(dayOfWeekValue) ? dayOfWeekValue : new Date().getDay(),
        time: timeValue,
        weeksAhead: Number(weeksAheadValue) || 4,
        timezone: ownerTimezone,
      }),
    [dayOfWeekValue, ownerTimezone, startDateValue, timeValue, weeksAheadValue],
  );

  const manualSlots = useFieldArray({
    control: form.control,
    name: "manualSlots",
  });
  const manualSlotValues = form.watch("manualSlots") ?? [];
  const initialised = useRef(false);

  useEffect(() => {
    form.setValue("useManualSchedule", true, { shouldDirty: false });
  }, [form]);

  useEffect(() => {
    if (!initialised.current && suggestions.length) {
      manualSlots.replace(suggestions.map((slot) => ({ date: slot.date, time: slot.time })));
      initialised.current = true;
    }
  }, [manualSlots, suggestions]);

  const selectedSlots: SelectedSlotDisplay[] = manualSlots.fields
    .map((field, index) => {
      const slot = manualSlotValues[index];
      if (!slot?.date || !slot?.time) return null;
      return { key: field.id, date: slot.date, time: slot.time } satisfies SelectedSlotDisplay;
    })
    .filter((value): value is SelectedSlotDisplay => Boolean(value));

  const addSlot = (slot: { date: string; time: string }) => {
    if (!slot.date || !slot.time) return;
    if (selectedSlots.some((existing) => existing.date === slot.date && existing.time === slot.time)) {
      return;
    }
    manualSlots.append({ date: slot.date, time: slot.time });
  };

  const removeSlot = (slotKey: string) => {
    const index = manualSlots.fields.findIndex((field) => field.id === slotKey);
    if (index >= 0) {
      manualSlots.remove(index);
    }
  };

  const resetToDefaults = () => {
    initialised.current = false;
    if (suggestions.length) {
      manualSlots.replace(suggestions.map((slot) => ({ date: slot.date, time: slot.time })));
      initialised.current = true;
    } else {
      manualSlots.replace([]);
    }
  };

  const calendarMonth = useMemo(() => {
    const first = selectedSlots[0]?.date ?? suggestions[0]?.date ?? startDateValue;
    if (!first) return new Date().toISOString().slice(0, 7);
    return first.slice(0, 7);
  }, [selectedSlots, suggestions, startDateValue]);

  const displayEndDate = useMemo(() => {
    const selected = selectedSlots
      .map((slot) => DateTime.fromISO(`${slot.date}T${slot.time}`, { zone: ownerTimezone }))
      .filter((dt) => dt.isValid)
      .sort((a, b) => a.toMillis() - b.toMillis());

    if (selected.length) {
      return selected[selected.length - 1];
    }

    const base = DateTime.fromISO(`${startDateValue}T${timeValue}`, { zone: ownerTimezone });
    if (!base.isValid) {
      return null;
    }

    const weeks = Math.max(1, Number(weeksAheadValue) || 4);
    return base.plus({ weeks: weeks - 1 });
  }, [ownerTimezone, selectedSlots, startDateValue, timeValue, weeksAheadValue]);

  const displayEndLabel = displayEndDate?.toFormat("cccc d LLLL yyyy");
  const ownerTimezoneLabel = ownerTimezone.replace(/_/g, " ");

  const startProgress = (message: string) => {
    setProgressMessage(message);
    setProgressValue(10);
    setProgressActive(true);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    progressTimerRef.current = setInterval(() => {
      setProgressValue((prev) => Math.min(prev + Math.random() * 10 + 4, 90));
    }, 500);
  };

  const stopProgress = () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setProgressValue(100);
    setTimeout(() => {
      setProgressActive(false);
      setProgressValue(0);
      setProgressMessage("");
    }, 400);
  };

  const refreshGeneratedItem = async (contentId: string) => {
    const details = await fetchGeneratedContentDetails({ contentIds: [contentId] });
    const detail = details[0];
    if (!detail) return;
    setGeneratedItems((prev) => prev.map((item) => (item.id === contentId ? detail : item)));
  };

  const onSubmit = form.handleSubmit((values) => {
    setGenerationError(null);
    setGeneratedItems([]);
    startProgress("Generating weekly content…");
    startTransition(async () => {
      try {
        const response = await handleWeeklyCampaignSubmission(values);
        setResult({ status: response.status, scheduledFor: response.scheduledFor });
        setProgressMessage("Preparing review…");
        setProgressValue((prev) => Math.max(prev, 70));
        const details = response.contentItemIds?.length
          ? await fetchGeneratedContentDetails({ contentIds: response.contentItemIds })
          : [];
        setGeneratedItems(details);
        form.reset({
          name: "",
          description: "",
          dayOfWeek: new Date().getDay().toString(),
          startDate: new Date().toISOString().slice(0, 10),
          time: "07:00",
          weeksAhead: "4",
          prompt: "",
          platforms: ["facebook", "instagram"],
          heroMedia: [],
          ctaUrl: "",
          linkInBioUrl: "",
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
          useManualSchedule: true,
          manualSlots: [],
        });
        initialised.current = false;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate weekly plan.";
        setGenerationError(message);
      } finally {
        stopProgress();
      }
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
          {(Object.keys(PLATFORM_LABELS) as Array<WeeklyCampaignInput["platforms"][number]>).map((platform) => {
            const selected = (form.watch("platforms") ?? []).includes(platform);
            return (
              <button
                key={platform}
                type="button"
                onClick={() => togglePlatform(form, platform)}
                className={`rounded-full border border-brand-ambergold bg-brand-ambergold px-4 py-2 text-sm font-medium text-white transition ${
                  selected ? "shadow-md ring-1 ring-brand-ambergold/30" : "shadow-sm opacity-80 hover:opacity-100"
                }`}
              >
                {PLATFORM_LABELS[platform]}
              </button>
            );
          })}
        </div>
        {form.formState.errors.platforms ? (
          <p className="text-xs text-rose-500">{form.formState.errors.platforms.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">Facebook CTA URL</label>
        <input
          type="url"
          placeholder="https://your-link.com"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          {...form.register("ctaUrl")}
        />
        {form.formState.errors.ctaUrl ? (
          <p className="text-xs text-rose-500">{form.formState.errors.ctaUrl.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">Link in bio destination</label>
        <p className="text-xs text-slate-500">Keep weekly features discoverable via the link-in-bio page.</p>
        <input
          type="url"
          placeholder="https://www.the-anchor.pub/weekly"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          {...form.register("linkInBioUrl")}
        />
        {form.formState.errors.linkInBioUrl ? (
          <p className="text-xs text-rose-500">{form.formState.errors.linkInBioUrl.message}</p>
        ) : null}
      </div>

      <MediaAttachmentSelector
        assets={library}
        selected={selectedMedia}
        onChange={(next) => form.setValue("heroMedia", next, { shouldDirty: true })}
        label="Hero media"
        description="Attach evergreen visuals to reuse across weekly slots."
        onLibraryUpdate={handleLibraryUpdate}
      />
      {form.formState.errors.heroMedia ? (
        <p className="text-xs text-rose-500">{form.formState.errors.heroMedia.message as string}</p>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">Pick your weekly slots</p>
            <p className="text-xs text-slate-500">
              We’ve prefilled the recommended cadence. Remove any you don’t want or add extras directly on the calendar.
            </p>
          </div>
          <button
            type="button"
            onClick={resetToDefaults}
            className="rounded-full border border-brand-ambergold bg-brand-ambergold px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-ambergold/90"
          >
            Reset to defaults
          </button>
        </div>
        <ScheduleCalendar
          timezone={ownerTimezone}
          initialMonth={calendarMonth}
          selected={selectedSlots}
          suggestions={suggestions}
          existingItems={plannerItems}
          onAddSlot={addSlot}
          onRemoveSlot={removeSlot}
        />
        {displayEndLabel ? (
          <p className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-brand-teal">
            Runs through {displayEndLabel} ({ownerTimezoneLabel})
          </p>
        ) : null}
        {form.formState.errors.manualSlots ? (
          <p className="text-xs text-rose-500">{form.formState.errors.manualSlots.message}</p>
        ) : null}
      </div>

      <AdvancedGenerationControls form={form} />

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-brand-ambergold px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-ambergold/90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending ? "Generating recurring plan…" : "Generate recurring plan"}
      </button>

      <GenerationProgress active={progressActive} value={progressValue} message={progressMessage} />

      {generationError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {generationError}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Draft posts created. Review each one below and approve when you’re ready.
        </div>
      ) : null}

      {generatedItems.length ? (
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Review & approve</h3>
          <p className="text-sm text-slate-500">Fine-tune media for each slot, then approve to schedule weekly posts.</p>
          <GeneratedContentReviewList
            items={generatedItems}
            ownerTimezone={ownerTimezone}
            mediaLibrary={library}
            onLibraryUpdate={handleLibraryUpdate}
            onRefreshItem={refreshGeneratedItem}
          />
        </section>
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
