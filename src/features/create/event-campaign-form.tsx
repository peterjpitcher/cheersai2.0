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

import {
  fetchGeneratedContentDetails,
  handleEventCampaignSubmission,
} from "@/app/(app)/create/actions";
import {
  eventCampaignFormSchema,
  type EventCampaignFormValues,
  type EventCampaignInput,
} from "@/lib/create/schema";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerOverview } from "@/lib/planner/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";
import { ScheduleCalendar, type SelectedSlotDisplay, type SuggestedSlotDisplay } from "@/features/create/schedule/schedule-calendar";
import { buildEventSuggestions } from "@/features/create/schedule/suggestion-utils";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";
import { StageAccordion, type StageAccordionControls } from "@/features/create/stage-accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PLATFORM_LABELS: Record<EventCampaignInput["platforms"][number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

interface EventCampaignFormProps {
  mediaLibrary: MediaAssetSummary[];
  plannerItems: PlannerOverview["items"];
  ownerTimezone: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  initialDate?: Date;
  onSuccess?: () => void;
}

import { DateTime } from "luxon";

export function EventCampaignForm({ mediaLibrary, plannerItems, ownerTimezone, onLibraryUpdate, initialDate, onSuccess }: EventCampaignFormProps) {
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

  const form = useForm<EventCampaignFormValues>({
    resolver: zodResolver(eventCampaignFormSchema) as Resolver<EventCampaignFormValues>,
    defaultValues: {
      name: "",
      description: "",
      startDate: initialDate
        ? DateTime.fromJSDate(initialDate).setZone(ownerTimezone).toISODate() ?? new Date().toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      startTime: "07:00",
      timezone: ownerTimezone,
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
      useManualSchedule: false,
      manualSlots: [],
    },
  });

  const selectedMedia = form.watch("heroMedia") ?? [];
  const startDateValue = form.watch("startDate");
  const startTimeValue = form.watch("startTime") ?? "07:00";
  const timezoneValue = form.watch("timezone") ?? ownerTimezone;
  const useManualScheduleValue = form.watch("useManualSchedule");

  useEffect(() => {
    form.setValue("timezone", ownerTimezone, { shouldDirty: false });
  }, [ownerTimezone, form]);

  const suggestions: SuggestedSlotDisplay[] = useMemo(
    () => buildEventSuggestions({ startDate: startDateValue, startTime: startTimeValue, timezone: timezoneValue }),
    [timezoneValue, startDateValue, startTimeValue],
  );

  const suggestionFieldSlots = useMemo(
    () => suggestions.map((slot) => ({ date: slot.date, time: slot.time })),
    [suggestions],
  );

  const manualSlots = useFieldArray({
    control: form.control,
    name: "manualSlots",
  });
  const manualSlotValues = form.watch("manualSlots") ?? [];
  const initialised = useRef(false);

  useEffect(() => {
    if (!useManualScheduleValue) {
      initialised.current = false;
      return;
    }
    if (initialised.current || !suggestions.length) {
      return;
    }
    manualSlots.replace(suggestionFieldSlots);
    initialised.current = true;
  }, [manualSlots, suggestionFieldSlots, suggestions.length, useManualScheduleValue]);

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
        key: `suggestion-${slot.id}`,
        date: slot.date,
        time: slot.time,
      })),
    [suggestions],
  );

  const displayedSlots = useManualScheduleValue ? manualSelectedSlots : autoSelectedSlots;
  const manualSlotsPresent = manualSelectedSlots.length > 0;

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
    if (!useManualScheduleValue) return;
    initialised.current = false;
    if (suggestionFieldSlots.length) {
      manualSlots.replace(suggestionFieldSlots);
      initialised.current = true;
    } else {
      manualSlots.replace([]);
    }
  };

  const clearManualSlots = () => {
    manualSlots.replace([]);
    initialised.current = false;
  };

  const handleManualToggle = (checked: boolean) => {
    form.setValue("useManualSchedule", checked, { shouldDirty: true });
    if (!checked) {
      clearManualSlots();
      return;
    }
    if (!manualSlots.fields.length && suggestionFieldSlots.length) {
      manualSlots.replace(suggestionFieldSlots);
    }
    initialised.current = true;
  };

  const calendarMonth = useMemo(() => {
    const first = displayedSlots[0]?.date ?? suggestions[0]?.date ?? startDateValue;
    if (!first) return new Date().toISOString().slice(0, 7);
    return first.slice(0, 7);
  }, [displayedSlots, suggestions, startDateValue]);

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
    startProgress("Generating campaign content…");
    startTransition(async () => {
      try {
        const response = await handleEventCampaignSubmission(values);
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
          startDate: new Date().toISOString().slice(0, 10),
          startTime: "07:00",
          timezone: ownerTimezone,
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
          useManualSchedule: false,
          manualSlots: [],
        });
        initialised.current = false;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate campaign.";
        setGenerationError(message);
      } finally {
        stopProgress();
      }
    });
  });

  const goToNextWhenValid = async (
    controls: StageAccordionControls,
    stageId: string,
    fields: (keyof EventCampaignFormValues)[],
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
      id: "overview",
      title: "Event overview",
      description: "Name the event and give us the core details.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof EventCampaignFormValues)[] = ["name", "description", "startDate", "startTime"];
          await goToNextWhenValid(controls, "overview", fields);
        };

        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="event-name">Event name</Label>
              <Input
                id="event-name"
                type="text"
                placeholder="e.g. Acoustic Fridays"
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <p className="text-xs text-rose-500">{form.formState.errors.name.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-description">Description</Label>
              <textarea
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                rows={4}
                placeholder="Give guests a feel for the event, the vibe, and why they shouldn’t miss it."
                {...form.register("description")}
              />
              {form.formState.errors.description ? (
                <p className="text-xs text-rose-500">{form.formState.errors.description.message}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-start-date">Date</Label>
                <Input
                  id="event-start-date"
                  type="date"
                  {...form.register("startDate")}
                />
                {form.formState.errors.startDate ? (
                  <p className="text-xs text-rose-500">{form.formState.errors.startDate.message}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-start-time">Start time</Label>
                <Input
                  id="event-start-time"
                  type="time"
                  {...form.register("startTime")}
                />
                {form.formState.errors.startTime ? (
                  <p className="text-xs text-rose-500">{form.formState.errors.startTime.message}</p>
                ) : null}
              </div>
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
      id: "channels",
      title: "Channels & links",
      description: "Pick platforms and the links we should promote.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof EventCampaignFormValues)[] = ["platforms", "ctaUrl", "linkInBioUrl"];
          await goToNextWhenValid(controls, "channels", fields);
        };

        return (
          <>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">Platforms</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(PLATFORM_LABELS) as Array<EventCampaignInput["platforms"][number]>).map((platform) => {
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
      title: "Hero media",
      description: "Attach the imagery that sells the experience.",
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
              description="Attach the best imagery or video that sells the event experience."
              onLibraryUpdate={handleLibraryUpdate}
            />
            {form.formState.errors.heroMedia ? (
              <p className="text-xs text-rose-500">{form.formState.errors.heroMedia.message as string}</p>
            ) : null}

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
      title: "Schedule",
      description: "Use the calendar to shape the campaign cadence.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const shouldValidateSlots = form.getValues("useManualSchedule");
          const fields: (keyof EventCampaignFormValues)[] = shouldValidateSlots ? ["manualSlots"] : [];
          await goToNextWhenValid(controls, "schedule", fields);
        };

        return (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Pick the hype moments</p>
                <p className="text-xs text-slate-500">
                  {useManualScheduleValue
                    ? "Tweak or delete any slots you don’t need. Turn off manual control to fall back to the recommended cadence."
                    : "We’ll schedule weekly hype posts plus 3-day, 2-day, and day-of reminders. Turn on manual control if you want to edit the exact dates."}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={useManualScheduleValue}
                    onChange={(event) => handleManualToggle(event.target.checked)}
                  />
                  Adjust manually
                </label>
                <button
                  type="button"
                  onClick={resetToDefaults}
                  disabled={!useManualScheduleValue}
                  className={`rounded-full border px-4 py-1.5 text-xs font-semibold text-white transition ${useManualScheduleValue
                    ? "border-brand-ambergold bg-brand-ambergold hover:bg-brand-ambergold/90"
                    : "border-brand-ambergold/40 bg-brand-ambergold/40 opacity-60"
                    }`}
                >
                  Apply suggestions
                </button>
                <button
                  type="button"
                  onClick={clearManualSlots}
                  disabled={!useManualScheduleValue || !manualSlotsPresent}
                  className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${useManualScheduleValue && manualSlotsPresent
                    ? "border-slate-400 text-slate-600 hover:border-slate-500 hover:text-slate-900"
                    : "border-slate-200 text-slate-300"
                    }`}
                >
                  Clear all
                </button>
              </div>
            </div>
            <ScheduleCalendar
              timezone={timezoneValue}
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
                Slots shown reflect the automated recommendations. Enable manual editing to add or remove specific beats.
              </p>
            ) : null}
            {form.formState.errors.manualSlots ? (
              <p className="text-xs text-rose-500">{form.formState.errors.manualSlots.message}</p>
            ) : null}

            <div className="flex justify-end pt-4">
              <button
                type="button"
                className="rounded-full bg-brand-teal px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-teal/90"
                onClick={() => void handleNext()}
              >
                Next
              </button>
            </div>
          </div>
        );
      },
    },
    {
      id: "generate",
      title: "Generate & review",
      description: "Generate drafts, then approve them.",
      defaultOpen: true,
      content: (
        <>
          <Button
            type="submit"
            disabled={isPending}
          >
            {isPending ? "Generating schedule…" : "Generate schedule"}
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
              <p className="text-sm text-slate-500">Swap media, then approve each draft to place it on the schedule.</p>
              <GeneratedContentReviewList
                items={generatedItems}
                ownerTimezone={ownerTimezone}
                mediaLibrary={library}
                onLibraryUpdate={handleLibraryUpdate}
                onRefreshItem={refreshGeneratedItem}
              />
              {onSuccess ? (
                <div className="flex justify-end pt-4 border-t border-slate-100">
                  <Button variant="outline" onClick={onSuccess}>
                    Done
                  </Button>
                </div>
              ) : null}
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
  form: UseFormReturn<EventCampaignFormValues>,
  platform: EventCampaignInput["platforms"][number],
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
