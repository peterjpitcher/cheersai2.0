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
import { useForm, useFieldArray, useWatch, type Resolver, type UseFormReturn } from "react-hook-form";
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
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const watchedSlots = useWatch({ control: form.control, name: "slots" });
  const slotValues = useMemo(() => watchedSlots ?? [], [watchedSlots]);
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

  const imageLibrary = useMemo(() => {
    const storyAssets = library.filter(
      (asset) => asset.mediaType === "image" && asset.previewShape === "story",
    );
    if (storyAssets.length) return storyAssets;
    return library.filter((asset) => asset.mediaType === "image");
  }, [library]);

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

  const handleSlotMediaSelect = (slotIndex: number, asset: MediaAssetSummary | null) => {
    if (!asset) {
      form.setValue(`slots.${slotIndex}.media`, [], { shouldDirty: true, shouldValidate: true });
      return;
    }

    const mediaInput = {
      assetId: asset.id,
      mediaType: asset.mediaType,
      fileName: asset.fileName,
    } as StorySeriesFormValues["slots"][number]["media"][number];

    form.setValue(`slots.${slotIndex}.media`, [mediaInput], { shouldDirty: true, shouldValidate: true });
    void ensurePreviewForAsset(asset.id);
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
              <Label htmlFor="story-title">
                Series name
              </Label>
              <Input
                id="story-title"
                type="text"
                placeholder="Weekend story drops"
                {...form.register("title")}
              />
              {form.formState.errors.title ? (
                <p className="text-xs text-rose-500">{form.formState.errors.title.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="story-notes">
                Overlay notes (optional)
              </Label>
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
              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  onClick={() => void handleNext()}
                  className="bg-brand-teal hover:bg-brand-teal/90"
                >
                  Next
                </Button>
              </div>
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
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
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
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeSlot(field.id)}
                            className="text-xs text-slate-500 hover:border-rose-200 hover:text-rose-600 h-auto py-1 px-3"
                          >
                            Remove
                          </Button>
                        </div>

                        <div className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 aspect-square">
                          {selectedMedia && previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewUrl}
                              alt={selectedSummary?.fileName ?? "Story media"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-500">
                              Select a story-ready image to lock in this slot.
                            </div>
                          )}
                        </div>

                        {mediaError ? <p className="text-xs text-rose-500">{mediaError}</p> : null}

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Choose story image
                          </p>
                          <StoryImageScroller
                            assets={imageLibrary}
                            selectedId={selectedMedia?.assetId ?? null}
                            onSelect={(asset) => handleSlotMediaSelect(index, asset)}
                            onClear={() => handleSlotMediaSelect(index, null)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
          <Button
            type="submit"
            disabled={isPending}
          >
            {isPending ? "Scheduling…" : "Schedule stories"}
          </Button>

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

interface StoryImageScrollerProps {
  assets: MediaAssetSummary[];
  selectedId: string | null;
  onSelect: (asset: MediaAssetSummary) => void;
  onClear: () => void;
}

function StoryImageScroller({ assets, selectedId, onSelect, onClear }: StoryImageScrollerProps) {
  const [expanded, setExpanded] = useState(false);

  if (!assets.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
        Upload story-ready images in your Library to attach them here.
      </div>
    );
  }

  const containerClass = expanded
    ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 max-h-80 overflow-y-auto pr-1"
    : "flex gap-2 overflow-x-auto pb-1";

  const baseThumbClass = expanded
    ? "relative w-full overflow-hidden rounded-lg border"
    : "relative w-16 shrink-0 overflow-hidden rounded-lg border";

  return (
    <div className="space-y-3">
      <div className={containerClass}>
        {assets.map((asset) => {
          const preview = asset.previewUrl;
          const isSelected = selectedId === asset.id;
          const fallbackLabel = asset.fileName?.slice(0, 8) ?? "Image";
          const aspectClass = "aspect-[9/16]";

          return (
            <Button
              key={asset.id}
              type="button"
              onClick={() => onSelect(asset)}
              className={cn(baseThumbClass, aspectClass, "transition", {
                "border-brand-navy ring-2 ring-brand-navy/40": isSelected,
                "border-slate-200 hover:border-slate-400": !isSelected,
              })}
              title={asset.fileName ?? "Story image"}
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={asset.fileName ?? "Story image"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-100 px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {fallbackLabel}
                </div>
              )}
              {isSelected ? (
                <span className="absolute inset-0 flex items-center justify-center bg-white/60 text-[10px] font-semibold uppercase tracking-wide text-brand-navy">
                  Selected
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>
      {selectedId ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={onClear}
          className="text-xs text-slate-500 hover:text-rose-500 h-auto p-0"
        >
          Remove image
        </Button>
      ) : null}
      <div className="flex items-center justify-between text-[10px]">
        <p className="text-slate-500">
          Need a new visual?{" "}
          <Button
            asChild
            variant="link"
            size="sm"
            className="h-auto p-0 font-semibold text-brand-teal hover:underline"
          >
            <a
              href="/library"
              target="_blank"
              rel="noreferrer"
            >
              Open the library
            </a>
          </Button>
          .
        </p>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => setExpanded((prev) => !prev)}
          className="h-auto p-0 font-semibold text-brand-navy hover:underline"
        >
          {expanded ? "Collapse picker" : "Expand picker"}
        </Button>
      </div>
    </div>
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
