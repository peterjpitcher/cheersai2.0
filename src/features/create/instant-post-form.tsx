"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DateTime } from "luxon";

import {
  fetchGeneratedContentDetails,
} from "@/app/(app)/create/actions";
import {
  instantPostFormSchema,
  type InstantPostFormValues,
  type InstantPostInput,
  type MediaAssetInput,
} from "@/lib/create/schema";
import { DEFAULT_POST_TIME, STORY_POST_TIME } from "@/lib/constants";
import { formatStoryScheduleInputValue } from "@/lib/create/story-schedule";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";
import { StreamingPreview } from "@/features/create/streaming-preview";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";
import { StageAccordion, type StageAccordionControls } from "@/features/create/stage-accordion";
import { TemplateSelector } from "@/features/create/template-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PLATFORM_LABELS: Record<InstantPostInput["platforms"][number], string> = {
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

interface InstantPostFormProps {
  mediaLibrary: MediaAssetSummary[];
  ownerTimezone: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
  initialDate?: Date;
  initialMedia?: MediaAssetSummary[];
  onSuccess?: () => void;
}

// Shape of SSE events emitted by POST /api/create/generate-stream
interface StreamEvent {
  type: string;
  platform?: string;
  text?: string;
  contentItemIds?: string[];
  message?: string;
}

export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate, initialDate, initialMedia, onSuccess }: InstantPostFormProps) {
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progressActive, setProgressActive] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  // Streaming preview state: accumulated text per platform key
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [streamingPlatforms, setStreamingPlatforms] = useState<string[]>([]);
  // AbortController for the in-flight SSE fetch
  const abortControllerRef = useRef<AbortController | null>(null);
  const [generatedItems, setGeneratedItems] = useState<PlannerContentDetail[]>([]);
  const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaLibrary);

  useEffect(() => {
    setLibrary(mediaLibrary);
  }, [mediaLibrary]);

  useEffect(() => () => {
    // Abort any in-flight stream on unmount
    abortControllerRef.current?.abort();
  }, []);

  const handleLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>> = (updater) => {
    setLibrary((prev) => (typeof updater === "function" ? (updater as (value: MediaAssetSummary[]) => MediaAssetSummary[])(prev) : updater));
    if (onLibraryUpdate) {
      onLibraryUpdate(updater);
    }
  };

  const form = useForm<InstantPostFormValues>({
    resolver: zodResolver(instantPostFormSchema) as Resolver<InstantPostFormValues>,
    defaultValues: {
      title: "",
      prompt: "",
      publishMode: initialDate ? "schedule" : "now",
      scheduledFor: initialDate
        ? DateTime.fromJSDate(initialDate)
            .setZone(ownerTimezone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : undefined,
      platforms: ["facebook", "instagram"],
      media: initialMedia?.map(m => ({
        assetId: m.id,
        mediaType: m.mediaType,
        fileName: m.fileName
      })) ?? [],
      ctaUrl: "",
      ctaLabel: "",
      linkInBioUrl: "",
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      placement: "feed",
      proofPointMode: "off",
      proofPointsSelected: [],
      proofPointIntentTags: [],
    },
  });

  const publishMode = form.watch("publishMode");
  const selectedMedia = form.watch("media") ?? [];
  const placement = form.watch("placement");
  const scheduledForValue = form.watch("scheduledFor");
  const storyDateValue = scheduledForValue?.slice(0, 10) ?? "";

  const setStoryScheduledDate = useCallback((value: string | Date | null | undefined) => {
    const resolved = formatStoryScheduleInputValue(value ?? new Date(), ownerTimezone);
    if (!resolved) return;
    form.setValue("scheduledFor", resolved, { shouldDirty: true, shouldValidate: true });
  }, [form, ownerTimezone]);

  useEffect(() => {
    if (publishMode !== "schedule") return;
    const current = form.getValues("scheduledFor");
    if (current) return;

    const now = DateTime.now().setZone(ownerTimezone);
    let next = now.set({
      hour: Number(DEFAULT_POST_TIME.split(":")[0]),
      minute: Number(DEFAULT_POST_TIME.split(":")[1]),
      second: 0,
      millisecond: 0,
    });
    if (next <= now) {
      next = next.plus({ days: 1 });
    }
    form.setValue("scheduledFor", next.toFormat("yyyy-MM-dd'T'HH:mm"), { shouldDirty: true });
  }, [form, ownerTimezone, publishMode]);

  useEffect(() => {
    if (placement === "story") {
      if (form.getValues("publishMode") !== "schedule") {
        form.setValue("publishMode", "schedule", { shouldDirty: true });
      }
      setStoryScheduledDate(form.getValues("scheduledFor") ?? new Date());

      const currentPlatforms = form.getValues("platforms") ?? [];
      const filtered = currentPlatforms.filter(
        (platform): platform is InstantPostInput["platforms"][number] => platform !== "gbp",
      );
      const nextPlatforms: InstantPostInput["platforms"] = filtered.length ? filtered : ["instagram"];
      if (filtered.length !== currentPlatforms.length || filtered.length === 0) {
        form.setValue("platforms", nextPlatforms, { shouldDirty: true });
      }
    }
  }, [placement, form, setStoryScheduledDate]);

  const startProgress = (message: string) => {
    setProgressMessage(message);
    setProgressActive(true);
  };

  const stopProgress = () => {
    setProgressActive(false);
    setProgressMessage("");
  };

  const refreshGeneratedItem = async (contentId: string) => {
    const details = await fetchGeneratedContentDetails({ contentIds: [contentId] });
    const detail = details[0];
    if (!detail) return;
    setGeneratedItems((prev) => prev.map((item) => (item.id === contentId ? detail : item)));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setGenerationError(null);
    setGeneratedItems([]);
    setStreamingText({});
    setStreamingPlatforms(values.platforms ?? []);
    setResult(null);

    const progressLabel = placement === "story" ? "Creating story…" : "Generating post variants…";
    startProgress(progressLabel);
    setIsPending(true);

    // Abort any previous in-flight stream before starting a new one
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/create/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(errorBody.error ?? `Request failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error("No response body received.");
      }

      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += textDecoder.decode(value, { stream: true });

        // Process complete SSE lines; keep any incomplete trailing line in the buffer
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(jsonStr) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "platform_start" && event.platform) {
            const label =
              event.platform === "gbp"
                ? "Google Business Profile"
                : event.platform.charAt(0).toUpperCase() + event.platform.slice(1);
            setProgressMessage(`Generating ${label} copy…`);
          } else if (event.type === "chunk" && event.platform && event.text) {
            const platform = event.platform;
            const chunk = event.text;
            setStreamingText((prev) => ({
              ...prev,
              [platform]: (prev[platform] ?? "") + chunk,
            }));
          } else if (event.type === "done" && event.contentItemIds?.length) {
            setProgressMessage("Preparing review…");
            const details = await fetchGeneratedContentDetails({ contentIds: event.contentItemIds });
            setGeneratedItems(details);
            setResult({ status: "draft", scheduledFor: null });
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Content generation failed.");
          }
        }
      }

      const resetPlacement = values.placement ?? "feed";
      form.reset({
        title: "",
        prompt: "",
        publishMode: "now",
        platforms: ["facebook", "instagram"],
        media: [],
        ctaUrl: "",
        ctaLabel: "",
        linkInBioUrl: "",
        scheduledFor: undefined,
        toneAdjust: "default",
        lengthPreference: "standard",
        includeHashtags: true,
        includeEmojis: true,
        ctaStyle: "default",
        placement: resetPlacement,
        proofPointMode: "off",
        proofPointsSelected: [],
        proofPointIntentTags: [],
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // User navigated away or re-submitted; silently ignore
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to generate content.";
      setGenerationError(message);
    } finally {
      stopProgress();
      setIsPending(false);
    }
  });

  const handleMediaAttachmentsChange = (next: MediaAssetInput[]) => {
    if (placement !== "story") {
      form.clearErrors("media");
      form.setValue("media", next, { shouldDirty: true });
      return;
    }

    const previous = form.getValues("media") ?? [];
    const imagesOnly = next.filter((item) => item.mediaType === "image");
    let finalSelection = imagesOnly;

    if (imagesOnly.length !== next.length) {
      form.setError("media", { type: "manual", message: "Stories support images only." });
    }

    if (imagesOnly.length > 1) {
      const added = imagesOnly.find((item) => !previous.some((prevItem) => prevItem.assetId === item.assetId));
      finalSelection = added ? [added] : imagesOnly.slice(0, 1);
      form.setError("media", { type: "manual", message: "Stories can only include one image." });
    } else if (imagesOnly.length === 1) {
      form.clearErrors("media");
    } else {
      form.setError("media", { type: "manual", message: "Attach one image for this story." });
    }

    form.setValue("media", finalSelection, { shouldDirty: true });
  };

  const goToNextWhenValid = async (
    controls: StageAccordionControls,
    stageId: string,
    fields: (keyof InstantPostFormValues)[],
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
      title: "Post basics",
      description: "Set the essentials for this instant post.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof InstantPostFormValues)[] = ["title"];
          if (form.getValues("placement") !== "story") {
            fields.push("prompt");
          }
          await goToNextWhenValid(controls, "basics", fields);
        };

        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="instant-title">Title</Label>
              <Input
                id="instant-title"
                type="text"
                placeholder="e.g. Friday Night Hype"
                {...form.register("title")}
              />
              {form.formState.errors.title ? (
                <p className="text-xs text-rose-500">{form.formState.errors.title.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">Placement</p>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: "feed", label: "Feed post" },
                  { id: "story", label: "Story" },
                ] as const).map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant={placement === option.id ? "default" : "outline"}
                    onClick={() => form.setValue("placement", option.id, { shouldDirty: true })}
                    className={placement !== option.id ? "bg-white shadow-sm" : ""}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {placement === "story" ? (
                <p className="text-xs text-slate-500">Stories schedule a single 9:16 image for {STORY_POST_TIME} without copy.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instant-prompt">What should we post?</Label>
              <textarea
                id="instant-prompt"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:bg-slate-100"
                rows={4}
                placeholder={
                  placement === "story"
                    ? "Stories publish without captions."
                    : "Give us the context, vibe, and anything we must mention"
                }
                disabled={placement === "story"}
                {...form.register("prompt")}
              />
              {placement !== "story" && form.formState.errors.prompt ? (
                <p className="text-xs text-rose-500">{form.formState.errors.prompt.message}</p>
              ) : null}
            </div>

            {placement !== "story" ? (
              <TemplateSelector
                currentPrompt={form.watch("prompt")}
                currentPlatforms={form.watch("platforms")}
                currentToneAdjust={form.watch("toneAdjust")}
                onSelect={(template) => {
                  form.setValue("prompt", template.prompt, { shouldDirty: true });
                  if (template.platforms.length) {
                    form.setValue("platforms", template.platforms as InstantPostInput["platforms"], { shouldDirty: true });
                  }
                }}
              />
            ) : null}

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => void handleNext()}
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
      title: "Channels & timing",
      description: "Choose platforms, scheduling, and optional links.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          const fields: (keyof InstantPostFormValues)[] = ["platforms", "ctaUrl", "linkInBioUrl"];
          if (form.getValues("publishMode") === "schedule") {
            fields.push("scheduledFor");
          }
          await goToNextWhenValid(controls, "channels", fields);
        };

        return (
          <>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">Platforms</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(PLATFORM_LABELS) as Array<InstantPostInput["platforms"][number]>).map((platform) => {
                  const selected = (form.watch("platforms") ?? []).includes(platform);
                  const disabled = placement === "story" && platform === "gbp";
                  return (
                    <Button
                      key={platform}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      onClick={() => !disabled && togglePlatform(form, platform)}
                      disabled={disabled}
                      className={!selected ? "bg-white shadow-sm" : ""}
                    >
                      {PLATFORM_LABELS[platform]}
                    </Button>
                  );
                })}
              </div>
              {placement === "story" ? (
                <p className="text-xs text-slate-500">Stories are available on Facebook and Instagram only.</p>
              ) : null}
              {form.formState.errors.platforms ? (
                <p className="text-xs text-rose-500">{form.formState.errors.platforms.message}</p>
              ) : null}
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">When should it publish?</p>
              {placement === "story" ? (
                <div className="space-y-2">
                  <Input
                    type="date"
                    value={storyDateValue}
                    onChange={(event) => setStoryScheduledDate(event.target.value)}
                  />
                  <p className="text-xs text-slate-500">
                    Stories are scheduled for {STORY_POST_TIME}. Timezone: {ownerTimezone.replace(/_/g, " ")}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        value="now"
                        checked={publishMode === "now"}
                        onChange={() => form.setValue("publishMode", "now")}
                      />
                      Publish now
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        value="schedule"
                        checked={publishMode === "schedule"}
                        onChange={() => form.setValue("publishMode", "schedule")}
                      />
                      Schedule for later
                    </label>
                  </div>
                  {publishMode === "schedule" ? (
                    <div className="space-y-2">
                      <Input
                        type="datetime-local"
                        {...form.register("scheduledFor")}
                      />
                      <p className="text-xs text-slate-500">Timezone: {ownerTimezone.replace(/_/g, " ")}</p>
                    </div>
                  ) : null}
                </>
              )}
              {form.formState.errors.scheduledFor ? (
                <p className="text-xs text-rose-500">
                  {form.formState.errors.scheduledFor.message as string}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instant-cta-url">
                Optional CTA link
              </Label>
              <Input
                id="instant-cta-url"
                type="url"
                placeholder="https://example.com/booking"
                disabled={placement === "story"}
                {...form.register("ctaUrl")}
              />
              <p className="text-xs text-slate-500">Included on Facebook posts as the primary call to action.</p>
              {form.formState.errors.ctaUrl ? (
                <p className="text-xs text-rose-500">{form.formState.errors.ctaUrl.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instant-cta-label">Link goal</Label>
              <select
                id="instant-cta-label"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:opacity-60"
                disabled={placement === "story"}
                {...form.register("ctaLabel")}
              >
                {LINK_GOAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Guides the call-to-action language (and the label next to the Facebook link, if provided).
              </p>
              {form.formState.errors.ctaLabel ? (
                <p className="text-xs text-rose-500">{form.formState.errors.ctaLabel.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="instant-link-in-bio-url">
                Link in bio destination
              </Label>
              <p className="text-xs text-slate-500">
                Guests land here when they tap the tile on your link-in-bio page.
              </p>
              <Input
                id="instant-link-in-bio-url"
                type="url"
                placeholder="https://www.the-anchor.pub/book"
                disabled={placement === "story"}
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
              >
                Next
              </Button>
            </div>
          </>
        );
      },
    },
    {
      id: "creative",
      title: "Creative choices",
      description: "Attach the media to pair with this post.",
      content: (controls: StageAccordionControls) => {
        const handleNext = async () => {
          await goToNextWhenValid(controls, "creative", ["media"]);
        };

        return (
          <>
            <MediaAttachmentSelector
              assets={library}
              selected={selectedMedia}
              onChange={handleMediaAttachmentsChange}
              label="Media attachments"
              description={
                placement === "story"
                  ? "Stories publish a single processed 9:16 image from your Library."
                  : "Pick processed images or video from your Library. We’ll automatically use the right rendition per platform."
              }
              onLibraryUpdate={handleLibraryUpdate}
            />
            {form.formState.errors.media ? (
              <p className="text-xs text-rose-500">{form.formState.errors.media.message as string}</p>
            ) : null}

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => void handleNext()}
              >
                Next
              </Button>
            </div>
          </>
        );
      },
    },
    {
      id: "generate",
      title: "Generate & review",
      description: "Create draft posts, then review and approve them.",
      defaultOpen: true,
      content: (
        <>
          <Button
            type="submit"
            disabled={isPending}
          >
            {isPending
              ? placement === "story" ? "Creating story…" : "Generating post…"
              : placement === "story" ? "Create story" : "Generate post"}
          </Button>

          {/* Real-time streaming preview — visible while generation is active */}
          <StreamingPreview
            platforms={streamingPlatforms}
            streamingText={streamingText}
            active={progressActive}
          />

          {/* Status bar — shows current stage message while generating */}
          {progressActive ? (
            <GenerationProgress active={progressActive} value={0} message={progressMessage} />
          ) : null}

          {generationError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {generationError}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Draft posts created. Review the generated content below and approve when you&apos;re ready.
            </div>
          ) : null}

          {generatedItems.length ? (
            <section className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-900">Review & approve</h3>
              <p className="text-sm text-slate-500">
                Update attachments, then approve each post to schedule it automatically.
              </p>
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
  form: UseFormReturn<InstantPostFormValues>,
  platform: InstantPostInput["platforms"][number],
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
