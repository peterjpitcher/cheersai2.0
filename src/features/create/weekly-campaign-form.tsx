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
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";
import { ScheduleCalendar, type SelectedSlotDisplay, type SuggestedSlotDisplay } from "@/features/create/schedule/schedule-calendar";
import { buildWeeklySuggestions } from "@/features/create/schedule/suggestion-utils";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";
import { StageAccordion, type StageAccordionControls } from "@/features/create/stage-accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_POST_TIME } from "@/lib/constants";

const PLATFORM_LABELS: Record<WeeklyCampaignInput["platforms"][number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

const LINK_GOAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Learn more (default)" },
  { value: "Find out more", label: "Find out more" },
  { value: "Book now", label: "Book now" },
  { value: "Reserve a table", label: "Reserve a table" },
  { value: "View menu", label: "View menu" },
  { value: "Call now", label: "Call now" },
];

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
      time: DEFAULT_POST_TIME,
      weeksAhead: "4",
      prompt: "",
      platforms: ["facebook", "instagram"],
      heroMedia: [],
      ctaUrl: "",
      ctaLabel: "",
      linkInBioUrl: "",
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      proofPointMode: "off",
      proofPointsSelected: [],
      proofPointIntentTags: [],
      useManualSchedule: false,
      manualSlots: [],
    },
  });

  const selectedMedia = form.watch("heroMedia") ?? [];
  const dayOfWeekValue = Number(form.watch("dayOfWeek") ?? new Date().getDay());
  const startDateValue = form.watch("startDate");
  const timeValue = form.watch("time") ?? DEFAULT_POST_TIME;
  const weeksAheadValue = form.watch("weeksAhead") ?? "4";
  const useManualScheduleValue = form.watch("useManualSchedule");

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
  const manualInitialised = useRef(false);

  useEffect(() => {
    if (!useManualScheduleValue) {
      if (manualSlots.fields.length) {
        manualSlots.replace([]);
      }
      manualInitialised.current = false;
      return;
    }

    if (!manualInitialised.current) {
      if (suggestions.length) {
        manualSlots.replace(suggestions.map((slot) => ({ date: slot.date, time: slot.time })));
      } else {
        manualSlots.replace([]);
      }
      manualInitialised.current = true;
    }
  }, [useManualScheduleValue, manualSlots, suggestions]);

  const manualSelectedSlots: SelectedSlotDisplay[] = manualSlots.fields
    .map((field, index) => {
      const slot = manualSlotValues[index];
      if (!slot?.date || !slot?.time) return null;
      return { key: field.id, date: slot.date, time: slot.time } satisfies SelectedSlotDisplay;
    })
    .filter((value): value is SelectedSlotDisplay => Boolean(value));

  const autoSelectedSlots: SelectedSlotDisplay[] = useMemo(
    () =>
      suggestions.map((slot) => ({
        key: slot.id,
        date: slot.date,
        time: slot.time,
      })),
    [suggestions],
  );

  const displayedSlots = useManualScheduleValue ? manualSelectedSlots : autoSelectedSlots;

  const addSlot = (slot: { date: string; time: string }) => {
    if (!useManualScheduleValue) return;
    if (!slot.date || !slot.time) return;
    if (manualSelectedSlots.some((existing) => existing.date === slot.date && existing.time === slot.time)) {
      return;
    }
    manualSlots.append({ date: slot.date, time: slot.time });
  };

  const removeSlot = (slotKey: string) => {
    if (!useManualScheduleValue) return;
    const index = manualSlots.fields.findIndex((field) => field.id === slotKey);
    if (index >= 0) {
      manualSlots.remove(index);
    }
  };

  const resetToDefaults = () => {
    if (!useManualScheduleValue) {
      form.setValue("useManualSchedule", true, { shouldDirty: true });
    }
    manualInitialised.current = true;
    manualSlots.replace(suggestions.map((slot) => ({ date: slot.date, time: slot.time })));
  };

  const handleManualToggle = (checked: boolean) => {
    manualInitialised.current = false;
    form.setValue("useManualSchedule", checked, { shouldDirty: true });
  };

  const calendarMonth = useMemo(() => {
    const first = displayedSlots[0]?.date ?? suggestions[0]?.date ?? startDateValue;
    if (!first) return new Date().toISOString().slice(0, 7);
    return first.slice(0, 7);
  }, [displayedSlots, suggestions, startDateValue]);

  const displayEndDate = useMemo(() => {
    const selected = displayedSlots
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
  }, [ownerTimezone, displayedSlots, startDateValue, timeValue, weeksAheadValue]);

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
          time: DEFAULT_POST_TIME,
          weeksAhead: "4",
          prompt: "",
          platforms: ["facebook", "instagram"],
          heroMedia: [],
          ctaUrl: "",
          ctaLabel: "",
          linkInBioUrl: "",
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
          proofPointMode: "off",
          proofPointsSelected: [],
          proofPointIntentTags: [],
          useManualSchedule: false,
          manualSlots: [],
        });
        manualInitialised.current = false;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate weekly plan.";
        setGenerationError(message);
      } finally {
        stopProgress();
      }
    });
  });

  const goToNextWhenValid = async (
    controls: StageAccordionControls,
    stageId: string,
    fields: (keyof WeeklyCampaignFormValues)[],
  ) => {
    if (!fields.length) {
      controls.goToNext();
      return;
    }

    const isValid = await form.trigger(fields, { shouldFocus: true });
    if (isValid) {
      controls.goToNext();
    } else {
      controls.openStage(stageId, { exclusive: true });
    }
  };

  const stages = [
    {
      id: "basics",
      title: "Campaign basics",
      description: "Outline the weekly series and its vibe.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof WeeklyCampaignFormValues)[] = ["name", "description"];
          await goToNextWhenValid(controls, "basics", fields);
        };

        return (
          <>
          <div className="space-y-2">
            <Label htmlFor="weekly-campaign-name">Campaign name</Label>
            <Input
              id="weekly-campaign-name"
              type="text"
              placeholder="e.g. Thursday quiz night"
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="text-xs text-rose-500">{form.formState.errors.name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="weekly-description">Description</Label>
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

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={() => void handleNext()}
              className="bg-brand-teal hover:bg-brand-teal/90"
            >
              Next
            </Button>
          </div>
        </>
        );
      },
    },
    {
      id: "pattern",
      title: "Weekly pattern",
      description: "Tell us when this campaign goes live each week.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof WeeklyCampaignFormValues)[] = ["dayOfWeek", "time", "startDate", "weeksAhead"];
          await goToNextWhenValid(controls, "pattern", fields);
        };

        return (
          <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="weekly-day-of-week">Day of week</Label>
              <select
                id="weekly-day-of-week"
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
              <Label htmlFor="weekly-time">Time</Label>
              <Input
                id="weekly-time"
                type="time"
                {...form.register("time")}
              />
              {form.formState.errors.time ? (
                <p className="text-xs text-rose-500">{form.formState.errors.time.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="weekly-start-date">Start date</Label>
              <Input
                id="weekly-start-date"
                type="date"
                {...form.register("startDate")}
              />
              {form.formState.errors.startDate ? (
                <p className="text-xs text-rose-500">{form.formState.errors.startDate.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="weeks-ahead-to-schedule">Weeks ahead to schedule</Label>
              <Input
                id="weeks-ahead-to-schedule"
                type="number"
                min={1}
                max={12}
                {...form.register("weeksAhead")}
              />
              {form.formState.errors.weeksAhead ? (
                <p className="text-xs text-rose-500">{form.formState.errors.weeksAhead.message}</p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              className="rounded-full bg-brand-teal px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-teal/90"
              onClick={() => void handleNext()}
            >
              Next
            </button>
          </div>
        </>
        );
      },
    },
    {
      id: "channels",
      title: "Channels & links",
      description: "Select platforms and route guests to the right pages.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof WeeklyCampaignFormValues)[] = ["platforms", "ctaUrl", "linkInBioUrl"];
          await goToNextWhenValid(controls, "channels", fields);
        };

        return (
          <>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-900">Platforms</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PLATFORM_LABELS) as Array<WeeklyCampaignInput["platforms"][number]>).map((platform) => {
                const selected = (form.watch("platforms") ?? []).includes(platform);
                return (
                  <Button
                    key={platform}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    onClick={() => togglePlatform(form, platform)}
                    className={!selected ? "bg-white shadow-sm" : ""}
                  >
                    {PLATFORM_LABELS[platform]}
                  </Button>
                );
              })}
            </div>
            {form.formState.errors.platforms ? (
              <p className="text-xs text-rose-500">{form.formState.errors.platforms.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="facebook-cta-url">Facebook CTA URL</Label>
            <Input
              id="facebook-cta-url"
              type="url"
              placeholder="https://your-link.com"
              {...form.register("ctaUrl")}
            />
            {form.formState.errors.ctaUrl ? (
              <p className="text-xs text-rose-500">{form.formState.errors.ctaUrl.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="weekly-cta-label">Link goal</Label>
            <select
              id="weekly-cta-label"
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("ctaLabel")}
            >
              {LINK_GOAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">Used as the label next to your Facebook link, and to guide the CTA wording.</p>
            {form.formState.errors.ctaLabel ? (
              <p className="text-xs text-rose-500">{form.formState.errors.ctaLabel.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="weekly-link-in-bio-url">Link in bio destination</Label>
            <p className="text-xs text-slate-500">
              Used on your CheersAI link-in-bio page (keep UTMs separate from the Facebook link above).
            </p>
            <Input
              id="weekly-link-in-bio-url"
              type="url"
              placeholder="https://your-link.com?utm_source=linkinbio"
              {...form.register("linkInBioUrl")}
            />
            {form.formState.errors.linkInBioUrl ? (
              <p className="text-xs text-rose-500">{form.formState.errors.linkInBioUrl.message}</p>
            ) : null}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={() => void handleNext()}
              className="bg-brand-teal hover:bg-brand-teal/90"
            >
              Next
            </Button>
          </div>
        </>
        );
      },
    },
    {
      id: "media",
      title: "Creative assets",
      description: "Attach evergreen visuals to reuse across weekly slots.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          await goToNextWhenValid(controls, "media", ["heroMedia"]);
        };

        return (
          <>
          <MediaAttachmentSelector
            assets={library}
            selected={selectedMedia}
            onChange={(next) => form.setValue("heroMedia", next, { shouldDirty: true })}
            label="Hero media"
            description="Attach evergreen visuals to reuse across weekly slots."
            onLibraryUpdate={handleLibraryUpdate}
          />
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={() => void handleNext()}
              className="bg-brand-teal hover:bg-brand-teal/90"
            >
              Next
            </Button>
          </div>
        </>
        );
      },
    },
    {
      id: "schedule",
      title: "Schedule preview",
      description: "Review the upcoming cadence and make adjustments.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const shouldValidateSlots = form.getValues("useManualSchedule");
          const fields: (keyof WeeklyCampaignFormValues)[] = shouldValidateSlots ? ["manualSlots"] : [];
          await goToNextWhenValid(controls, "schedule", fields);
        };

        return (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Weekly cadence preview</p>
                <p className="text-xs text-slate-500">
                  {useManualScheduleValue
                    ? "Remove any you don’t want or add extras directly on the calendar."
                    : `We’ll auto-schedule the next ${Number(weeksAheadValue) || 4} weeks. Enable manual editing to fine-tune individual dates.`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={useManualScheduleValue}
                    onChange={(event) => handleManualToggle(event.target.checked)}
                  />
                  Adjust manually
                </label>
                <Button
                  type="button"
                  onClick={resetToDefaults}
                  disabled={!useManualScheduleValue}
                  variant={useManualScheduleValue ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                >
                  Reset to defaults
                </Button>
              </div>
            </div>
            <ScheduleCalendar
              timezone={ownerTimezone}
              initialMonth={calendarMonth}
              selected={displayedSlots}
              suggestions={suggestions}
              existingItems={plannerItems}
              onAddSlot={useManualScheduleValue ? addSlot : () => undefined}
              onRemoveSlot={useManualScheduleValue ? removeSlot : () => undefined}
              readOnly={!useManualScheduleValue}
            />
            {!useManualScheduleValue ? (
              <p className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                Slots shown reflect the automated schedule. Adjust the fields above or turn on manual editing to make changes.
              </p>
            ) : null}
            {displayEndLabel ? (
              <p className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-brand-teal">
                Runs through {displayEndLabel} ({ownerTimezoneLabel})
              </p>
            ) : null}
            {form.formState.errors.manualSlots ? (
              <p className="text-xs text-rose-500">{form.formState.errors.manualSlots.message}</p>
            ) : null}

            <div className="flex justify-end pt-4">
              <Button
                type="button"
                onClick={() => void handleNext()}
                className="bg-brand-teal hover:bg-brand-teal/90"
              >
                Next
              </Button>
            </div>
          </div>
        );
      },
    },
    {
      id: "generate",
      title: "Generate & review",
      description: "Generate drafts and approve the queue.",
      defaultOpen: true,
      content: (
        <>
          <Button
            type="submit"
            disabled={isPending}
          >
            {isPending ? "Generating recurring plan…" : "Generate recurring plan"}
          </Button>

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
              <p className="text-sm text-slate-500">Adjust media for each slot, then approve to schedule weekly posts.</p>
              <GeneratedContentReviewList
                items={generatedItems}
                ownerTimezone={ownerTimezone}
                mediaLibrary={library}
                onLibraryUpdate={handleLibraryUpdate}
                onRefreshItem={refreshGeneratedItem}
              />
            </section>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <form onSubmit={onSubmit}>
      <StageAccordion stages={stages} />
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
