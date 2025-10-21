"use client";

import {
  useCallback,
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
  handleStorySeriesSubmission,
} from "@/app/(app)/create/actions";
import { fetchMediaAssetPreviewUrl } from "@/app/(app)/library/actions";
import {
  storySeriesFormSchema,
  type StorySeriesFormValues,
} from "@/lib/create/schema";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerOverview } from "@/lib/planner/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { StageAccordion, type StageAccordionControls } from "@/features/create/stage-accordion";
import { ScheduleCalendar, type SelectedSlotDisplay } from "@/features/create/schedule/schedule-calendar";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";

const SUPPORTED_PLATFORMS = ["facebook", "instagram"] as const;
type SupportedPlatform = typeof SUPPORTED_PLATFORMS[number];
const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

interface StorySeriesFormProps {
  mediaLibrary: MediaAssetSummary[];
  plannerItems: PlannerOverview["items"];
  ownerTimezone: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
}

export function StorySeriesForm({
  mediaLibrary,
  plannerItems,
  ownerTimezone,
  onLibraryUpdate,
}: StorySeriesFormProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progressActive, setProgressActive] = useState(false);
  const [progressValue, setProgressValue] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [generatedItems, setGeneratedItems] = useState<PlannerContentDetail[]>([]);
  const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaLibrary);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  useEffect(() => {
    setLibrary(mediaLibrary);
  }, [mediaLibrary]);

  const [previewMap, setPreviewMap] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const asset of mediaLibrary) {
      if (asset.previewUrl) {
        initial[asset.id] = asset.previewUrl;
      }
    }
    return initial;
  });
  useEffect(
    () => () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    },
    [],
  );

  const handleLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>> = (updater) => {
    setLibrary((prev) =>
      typeof updater === "function" ? (updater as (value: MediaAssetSummary[]) => MediaAssetSummary[])(prev) : updater,
    );
    onLibraryUpdate?.(updater);
  };

  const form = useForm<StorySeriesFormValues>({
    resolver: zodResolver(storySeriesFormSchema) as Resolver<StorySeriesFormValues>,
    defaultValues: {
      title: "",
      notes: "",
      platforms: ["facebook", "instagram"],
      slots: [],
    },
  });

  const slots = useFieldArray({
    control: form.control,
    name: "slots",
  });
  useEffect(() => {
    setPreviewMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const asset of mediaLibrary) {
        if (asset.previewUrl && next[asset.id] !== asset.previewUrl) {
          next[asset.id] = asset.previewUrl;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mediaLibrary]);
  useEffect(() => {
    if (activeSlotId && !slots.fields.some((field) => field.id === activeSlotId)) {
      setActiveSlotId(null);
    }
  }, [activeSlotId, slots.fields]);
  const slotValues = form.watch("slots") ?? [];
  const selectedSlots: SelectedSlotDisplay[] = slots.fields
    .map((field, index) => {
      const slot = slotValues[index];
      if (!slot?.date || !slot?.time) return null;
      return { key: field.id, date: slot.date, time: slot.time } satisfies SelectedSlotDisplay;
    })
    .filter((value): value is SelectedSlotDisplay => Boolean(value));

  const slotEntries = useMemo(
    () =>
      slots.fields
        .map((field, index) => {
          const slot = slotValues[index];
          const occursAt = slot?.date && slot?.time
            ? DateTime.fromISO(`${slot.date}T${slot.time}`, { zone: ownerTimezone })
            : null;
          return {
            field,
            index,
            occursAt,
          };
        })
        .sort((a, b) => {
          const aTime = a.occursAt?.toMillis() ?? Number.POSITIVE_INFINITY;
          const bTime = b.occursAt?.toMillis() ?? Number.POSITIVE_INFINITY;
          return aTime - bTime;
        }),
    [slots.fields, slotValues, ownerTimezone],
  );

  const calendarMonth = useMemo(() => {
    const first = selectedSlots[0]?.date;
    if (!first) {
      return new Date().toISOString().slice(0, 7);
    }
    return first.slice(0, 7);
  }, [selectedSlots]);

  const imageLibrary = useMemo(
    () => library.filter((asset) => asset.mediaType === "image"),
    [library],
  );

  const startProgress = (message: string) => {
    setProgressMessage(message);
    setProgressValue(12);
    setProgressActive(true);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    progressTimerRef.current = setInterval(() => {
      setProgressValue((prev) => Math.min(prev + Math.random() * 10 + 5, 85));
    }, 600);
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
    }, 350);
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
    startProgress("Scheduling stories…");
    startTransition(async () => {
      try {
        const response = await handleStorySeriesSubmission(values);
        setResult(response);
        setProgressMessage("Preparing review…");
        setProgressValue((prev) => Math.max(prev, 70));

        const details = response.contentItemIds?.length
          ? await fetchGeneratedContentDetails({ contentIds: response.contentItemIds })
          : [];
        setGeneratedItems(details);

        form.reset({
          title: "",
          notes: "",
          platforms: values.platforms,
          slots: [],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to schedule stories.";
        setGenerationError(message);
      } finally {
        stopProgress();
      }
    });
  });

  const addSlot = (slot: { date: string; time: string }) => {
    if (!slot.date || !slot.time) return;
    const exists = selectedSlots.some(
      (existing) => existing.date === slot.date && existing.time === slot.time,
    );
    if (exists) return;
    slots.append({ date: slot.date, time: slot.time, media: [] });
  };

  const removeSlot = (slotKey: string) => {
    const index = slots.fields.findIndex((field) => field.id === slotKey);
    if (index >= 0) {
      slots.remove(index);
    }
  };

  const ensurePreviewForAsset = useCallback(
    async (assetId: string) => {
      let hasPreview = false;
      setPreviewMap((prev) => {
        if (prev[assetId]) {
          hasPreview = true;
          return prev;
        }
        const libraryAsset = library.find((asset) => asset.id === assetId);
        if (libraryAsset?.previewUrl) {
          hasPreview = true;
          return { ...prev, [assetId]: libraryAsset.previewUrl };
        }
        return prev;
      });

      if (hasPreview) return;

      try {
        const url = await fetchMediaAssetPreviewUrl(assetId);
        if (url) {
          setPreviewMap((prev) => ({ ...prev, [assetId]: url }));
        }
      } catch (error) {
        console.warn("[story-series] failed to fetch preview url", { assetId, error });
      }
    },
    [library],
  );

  const handleSlotMediaChange = (slotIndex: number, next: StorySeriesFormValues["slots"][number]["media"]) => {
    const imagesOnly = next.filter((item) => item.mediaType === "image");
    const limited = imagesOnly.slice(0, 1);
    form.setValue(`slots.${slotIndex}.media`, limited, { shouldDirty: true, shouldValidate: true });

    const selected = limited[0];
    if (selected) {
      void ensurePreviewForAsset(selected.assetId);
    }
  };

  const stages = [
    {
      id: "basics",
      title: "Series basics",
      description: "Name the lineup and choose the platforms.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          await goToNextWhenValid(form, controls, "basics", ["title", "platforms"]);
        };

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900" htmlFor="story-title">
                Series name
              </label>
              <input
                id="story-title"
                type="text"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                placeholder="Weekend story drops"
                {...form.register("title")}
              />
              {form.formState.errors.title ? (
                <p className="text-xs text-rose-500">{form.formState.errors.title.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900" htmlFor="story-notes">
                Overlay notes (optional)
              </label>
              <textarea
                id="story-notes"
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                placeholder="Add headline ideas or stickers to call out."
                {...form.register("notes")}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">Platforms</p>
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_PLATFORMS.map((platform) => {
                  const selected = (form.watch("platforms") ?? []).includes(platform);
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => togglePlatform(form, platform)}
                      className={`rounded-full border border-brand-ambergold px-4 py-2 text-sm font-medium transition ${
                        selected
                          ? "bg-brand-ambergold text-white shadow-md ring-1 ring-brand-ambergold/30"
                          : "bg-white text-brand-ambergold shadow-sm hover:bg-brand-ambergold/10"
                      }`}
                    >
                      {PLATFORM_LABELS[platform]}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500">Stories support Facebook and Instagram placements.</p>
              {form.formState.errors.platforms ? (
                <p className="text-xs text-rose-500">{form.formState.errors.platforms.message}</p>
              ) : null}
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
          </div>
        );
      },
    },
    {
      id: "schedule",
      title: "Schedule & media",
      description: "Drop in the exact moments and attach the story visuals.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          await goToNextWhenValid(form, controls, "schedule", ["slots"]);
        };
        const slotsError = form.formState.errors.slots;
        const generalSlotsError =
          slotsError && !Array.isArray(slotsError) ? (slotsError.message as string | undefined) : undefined;

        return (
          <div className="space-y-4">
            <ScheduleCalendar
              timezone={ownerTimezone}
              initialMonth={calendarMonth}
              selected={selectedSlots}
              existingItems={plannerItems}
              onAddSlot={addSlot}
              onRemoveSlot={removeSlot}
            />
            <p className="text-xs text-slate-500">Timezone: {ownerTimezone.replace(/_/g, " ")}</p>
            {generalSlotsError ? <p className="text-xs text-rose-500">{generalSlotsError}</p> : null}

            <div className="space-y-4">
              {slotEntries.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Add slots on the calendar above to start building your story queue.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {slotEntries.map(({ field, index, occursAt }) => {
                    const slot = slotValues[index];
                    if (!slot) return null;
                    const slotDate = occursAt ?? DateTime.fromISO(`${slot.date}T${slot.time}`, { zone: ownerTimezone });
                    const friendlyDate = slotDate.isValid ? slotDate.toFormat("cccc, d LLLL") : slot.date;
                    const friendlyTime = slotDate.isValid ? slotDate.toFormat("HH:mm") : slot.time;
                    const slotError = Array.isArray(slotsError)
                      ? (slotsError[index] as { media?: { message?: string }; message?: string } | undefined)
                      : undefined;
                    const mediaError = slotError?.media?.message ?? slotError?.message;
                    const selectedMedia = slot.media?.[0];
                    const selectedSummary = selectedMedia
                      ? imageLibrary.find((asset) => asset.id === selectedMedia.assetId)
                      : undefined;
                    const previewUrl =
                      (selectedMedia ? previewMap[selectedMedia.assetId] : undefined) ?? selectedSummary?.previewUrl;
                    const isActive = activeSlotId === field.id;

                    return (
                      <div
                        key={field.id}
                        className="flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{friendlyDate}</p>
                            <p className="text-xs text-slate-500">{friendlyTime} · Story</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveSlotId((current) => (current === field.id ? null : field.id))}
                              className="rounded-full border border-brand-ambergold bg-brand-ambergold px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-ambergold/90"
                            >
                              {selectedMedia ? "Swap image" : "Add image"}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSlot(field.id)}
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition hover:border-rose-200 hover:text-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="relative mx-auto w-full max-w-[260px] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                          {selectedMedia && previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewUrl}
                              alt={selectedSummary?.fileName ?? "Story media"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-500">
                              Attach a portrait image to lock in this story.
                            </div>
                          )}
                        </div>

                        {mediaError ? <p className="text-xs text-rose-500">{mediaError}</p> : null}

                        {isActive ? (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <MediaAttachmentSelector
                              assets={imageLibrary}
                              selected={slot.media ?? []}
                              onChange={(next) => handleSlotMediaChange(index, next)}
                              label="Story media"
                              description="Attach the portrait image that will ship with this story."
                              emptyHint="Upload a portrait image in your Library to attach it here."
                              onLibraryUpdate={handleLibraryUpdate}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
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
          </div>
        );
      },
    },
    {
      id: "review",
      title: "Review & approve",
      description: "Schedule the stories, then review the queue.",
      defaultOpen: true,
      content: (
        <>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-full bg-brand-ambergold px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-ambergold/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "Scheduling…" : "Schedule stories"}
          </button>

          <GenerationProgress active={progressActive} value={progressValue} message={progressMessage} />

          {generationError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {generationError}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Stories created. Swap any media below, then approve when you’re happy.
            </div>
          ) : null}

          {generatedItems.length ? (
            <section className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-900">Queue review</h3>
              <p className="text-sm text-slate-500">
                Stories publish without copy. Confirm the visuals or swap them before approving.
              </p>
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

async function goToNextWhenValid(
  form: UseFormReturn<StorySeriesFormValues>,
  controls: StageAccordionControls,
  stageId: string,
  fields: (keyof StorySeriesFormValues)[],
) {
  if (!fields.length) {
    controls.goToNext();
    return;
  }

  const valid = await form.trigger(fields, { shouldFocus: true });
  if (valid) {
    controls.goToNext();
  } else {
    controls.openStage(stageId, { exclusive: true });
  }
}

function togglePlatform(form: UseFormReturn<StorySeriesFormValues>, platform: SupportedPlatform) {
  const current = form.getValues("platforms") ?? [];
  if (current.includes(platform)) {
    form.setValue(
      "platforms",
      current.filter((item) => item !== platform),
      { shouldDirty: true, shouldValidate: true },
    );
  } else {
    form.setValue(
      "platforms",
      [...current, platform] as StorySeriesFormValues["platforms"],
      { shouldDirty: true, shouldValidate: true },
    );
  }
}
